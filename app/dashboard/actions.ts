"use server";

import { sha512 } from "js-sha512";
import { redirect } from "next/navigation";

import { clearDashboardSession, setDashboardSession } from "./auth";
import { db } from "@/utils/supabase/server";

export async function loginDashboardAction(formData: FormData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();

  if (!email || !password) {
    redirect("/dashboard/login?error=missing");
  }

  const passwordHash = sha512(password);
  const supabase = await db();

  const { data: user, error } = await supabase
    .from("dashboard_users")
    .select("id, email, role, booth_id")
    .eq("email", email)
    .eq("password_hash", passwordHash)
    .single();

  if (error || !user) {
    redirect("/dashboard/login?error=invalid");
  }

  let boothName: string | null = null;
  if (user.booth_id !== null && user.booth_id !== undefined) {
    const { data: booth } = await supabase
      .from("booth")
      .select("name")
      .eq("id", user.booth_id)
      .single();
    boothName = booth?.name || null;
  }

  await setDashboardSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    boothId: user.booth_id !== null && user.booth_id !== undefined ? String(user.booth_id) : null,
    boothName,
  });

  redirect("/dashboard");
}

export async function logoutDashboardAction() {
  await clearDashboardSession();
  redirect("/dashboard/login");
}

export async function createBoothUserAction(formData: FormData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();
  const boothId = formData.get("booth_id")?.toString();

  if (!email || !password || !boothId) {
    redirect("/dashboard/users?error=missing");
  }

  const passwordHash = sha512(password);
  const supabase = await db();

  // Check if email already exists
  const { data: existing } = await supabase
    .from("dashboard_users")
    .select("id")
    .eq("email", email)
    .single();

  if (existing) {
    redirect("/dashboard/users?error=exists");
  }

  const { error } = await supabase.from("dashboard_users").insert({
    email,
    password_hash: passwordHash,
    role: "user",
    booth_id: Number(boothId),
  });

  if (error) {
    console.error("Failed to create user:", error);
    redirect("/dashboard/users?error=db");
  }

  // Send password via email
  try {
    const { sendEmailToUser } = await import("@/app/dashboard/mail");
    await sendEmailToUser(email, password);
  } catch (e) {
    console.error("Failed to send email:", e);
    // User created but email failed — continue anyway
  }

  redirect("/dashboard/users?success=1");
}

// ── Global price ──────────────────────────────────────────────
export async function updateGlobalPriceAction(formData: FormData) {
  const price = Number(formData.get("price"));
  if (!price || price < 0) {
    redirect("/dashboard/pricing?error=invalid_price");
  }

  const supabase = await db();

  // Update price on ALL booths
  const { error } = await supabase
    .from("booth")
    .update({ price })
    .gte("id", 0); // update all rows

  if (error) {
    console.error("Failed to update global price:", error);
    redirect("/dashboard/pricing?error=db");
  }

  redirect("/dashboard/pricing?success=price");
}

// ── Booth-specific price ──────────────────────────────────────
export async function updateBoothPriceAction(formData: FormData) {
  const boothId = Number(formData.get("booth_id"));
  const price = Number(formData.get("price"));
  if (Number.isNaN(boothId) || price < 0) {
    redirect(`/dashboard/booths/${boothId}?error=invalid_price`);
  }

  const supabase = await db();

  const { error } = await supabase
    .from("booth")
    .update({ price })
    .eq("id", boothId);

  if (error) {
    console.error("Failed to update booth price:", error);
    redirect(`/dashboard/booths/${boothId}?error=db`);
  }

  redirect(`/dashboard/booths/${boothId}?success=price`);
}

// ── Booth notice print ────────────────────────────────────────
export async function updateBoothNoticePrintAction(formData: FormData) {
  const boothId = Number(formData.get("booth_id"));
  const raw = formData.get("notice_print")?.toString().trim();

  if (Number.isNaN(boothId)) {
    redirect(`/dashboard/booths/${boothId}?error=invalid_notice`);
  }

  // Allow clearing the value (empty string → null)
  const noticePrint = raw === "" || raw === undefined ? null : Math.trunc(Number(raw));

  if (raw !== "" && raw !== undefined && (Number.isNaN(noticePrint) || (noticePrint as number) < 1)) {
    redirect(`/dashboard/booths/${boothId}?error=invalid_notice`);
  }

  const supabase = await db();

  const { error } = await supabase
    .from("booth")
    .update({ notice_print: noticePrint })
    .eq("id", boothId);

  if (error) {
    console.error("Failed to update booth notice_print:", error);
    redirect(`/dashboard/booths/${boothId}?error=db`);
  }

  redirect(`/dashboard/booths/${boothId}?success=notice`);
}

// ── Voucher CRUD ──────────────────────────────────────────────
export async function createVoucherAction(formData: FormData) {
  const name = formData.get("name")?.toString().trim();
  const code = formData.get("code")?.toString().trim().toUpperCase();
  const discountType = formData.get("discount_type")?.toString();
  const discountValue = Number(formData.get("discount_value"));
  const maxUsage = Number(formData.get("max_usage"));
  const expiresAt = formData.get("expires_at")?.toString();
  const allowedBoothIds = [...new Set(
    formData
      .getAll("allowed_booth_ids")
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0)
  )];

  if (!name || !code || !discountType || !discountValue || !maxUsage || !expiresAt || allowedBoothIds.length === 0) {
    redirect("/dashboard/pricing?error=missing");
  }

  const supabase = await db();

  const { error } = await supabase.from("voucher").insert({
    name,
    code,
    discount_type: discountType,
    discount_value: discountValue,
    max_usage: maxUsage,
    current_usage: 0,
    expires_at: new Date(expiresAt).toISOString(),
    allowed_booth_ids: allowedBoothIds,
  });

  if (error) {
    console.error("Failed to create voucher:", error);
    if (error.code === "23505") {
      redirect("/dashboard/pricing?error=code_exists");
    }
    redirect("/dashboard/pricing?error=db");
  }

  redirect("/dashboard/pricing?success=voucher");
}

export async function deleteVoucherAction(formData: FormData) {
  const voucherId = formData.get("voucher_id")?.toString();
  if (!voucherId) return;

  const supabase = await db();

  const { error } = await supabase.from("voucher").delete().eq("id", voucherId);

  if (error) {
    console.error("Failed to delete voucher:", error);
    redirect("/dashboard/pricing?error=db");
  }

  redirect("/dashboard/pricing?success=deleted");
}

// ── User management ───────────────────────────────────────────
export async function deleteUserAction(formData: FormData) {
  const userId = formData.get("user_id")?.toString();
  if (!userId) return;

  const supabase = await db();

  // Prevent deleting superuser accounts
  const { data: user } = await supabase
    .from("dashboard_users")
    .select("role")
    .eq("id", userId)
    .single();

  if (user?.role === "superuser") {
    redirect("/dashboard/users?error=cannot_delete_super");
  }

  const { error } = await supabase.from("dashboard_users").delete().eq("id", userId);

  if (error) {
    console.error("Failed to delete user:", error);
    redirect("/dashboard/users?error=db");
  }

  redirect("/dashboard/users?success=deleted");
}

// ── Change password ───────────────────────────────────────────
export async function changePasswordAction(formData: FormData) {
  const userId = formData.get("user_id")?.toString();
  const oldPassword = formData.get("old_password")?.toString();
  const newPassword = formData.get("new_password")?.toString();
  const confirmPassword = formData.get("confirm_password")?.toString();

  if (!userId || !oldPassword || !newPassword || !confirmPassword) {
    redirect("/dashboard/settings?error=missing");
  }

  if (newPassword !== confirmPassword) {
    redirect("/dashboard/settings?error=mismatch");
  }

  if (newPassword.length < 6) {
    redirect("/dashboard/settings?error=too_short");
  }

  const supabase = await db();

  // Verify old password
  const oldHash = sha512(oldPassword);
  const { data: user } = await supabase
    .from("dashboard_users")
    .select("id")
    .eq("id", userId)
    .eq("password_hash", oldHash)
    .single();

  if (!user) {
    redirect("/dashboard/settings?error=wrong_password");
  }

  // Update to new password
  const newHash = sha512(newPassword);
  const { error } = await supabase
    .from("dashboard_users")
    .update({ password_hash: newHash })
    .eq("id", userId);

  if (error) {
    console.error("Failed to change password:", error);
    redirect("/dashboard/settings?error=db");
  }

  redirect("/dashboard/settings?success=password");
}
