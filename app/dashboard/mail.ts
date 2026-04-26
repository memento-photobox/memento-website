import { createTransport } from "nodemailer";
import { env } from "@/app/env";

const transporter = createTransport({
  service: "gmail",
  auth: {
    user: env.emailUser,
    pass: env.gmailAppPassword,
  },
});

export async function sendNoticePrintEmail(
  boothId: number,
  boothName: string,
  noticePrint: number,
  currentMonthPrints: number,
  monthLabel: string,
): Promise<void> {
  const mailOptions = {
    from: env.emailUser,
    to: env.emailUser,
    subject: `[Memento] Notice Print Tercapai — ${boothName || `Booth ${boothId}`}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 12px;">🖨️ Notice Print Tercapai</h2>
        <p>
          Booth <strong>${boothName || `Booth ${boothId}`}</strong> (ID: ${boothId})
          telah mencapai batas notice print bulan ini.
        </p>
        <table style="margin:16px 0;border-collapse:collapse;width:100%;">
          <tr>
            <td style="padding:6px 12px 6px 0;color:#888;font-size:13px;">Periode</td>
            <td style="padding:6px 0;font-weight:bold;">${monthLabel}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px 6px 0;color:#888;font-size:13px;">Notice Print</td>
            <td style="padding:6px 0;font-weight:bold;">${noticePrint.toLocaleString("id-ID")} print</td>
          </tr>
          <tr>
            <td style="padding:6px 12px 6px 0;color:#888;font-size:13px;">Total Print Bulan Ini</td>
            <td style="padding:6px 0;font-weight:bold;">${currentMonthPrints.toLocaleString("id-ID")} print</td>
          </tr>
        </table>
        <p style="color:#888;font-size:12px;">— Memento Auto-Notification</p>
      </div>
    `,
  };

  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error("Notice print email send error:", err);
        reject(err);
      } else {
        console.log("Notice print email sent:", info);
        resolve();
      }
    });
  });
}

export async function sendEmailToUser(toEmail: string, password: string): Promise<void> {
  const mailOptions = {
    from: env.emailUser,
    to: toEmail,
    subject: "Memento Dashboard — Akun Booth Anda",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 12px;">Selamat datang di Memento Dashboard 📸</h2>
        <p>Akun dashboard booth Anda telah dibuat oleh admin.</p>
        <table style="margin:16px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:4px 12px 4px 0;font-weight:bold;">Email</td>
            <td style="padding:4px 0;">${toEmail}</td>
          </tr>
          <tr>
            <td style="padding:4px 12px 4px 0;font-weight:bold;">Password</td>
            <td style="padding:4px 0;"><code>${password}</code></td>
          </tr>
        </table>
        <p>Silakan login di dashboard dan segera ganti password Anda.</p>
        <p style="color:#888;font-size:12px;">— Tim Memento</p>
      </div>
    `,
  };

  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error("Email send error:", err);
        reject(err);
      } else {
        console.log("Email sent:", info);
        resolve();
      }
    });
  });
}
