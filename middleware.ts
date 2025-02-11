import { NextRequest, NextResponse } from "next/server";

 
export function middleware(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Basic ${process.env.BASIC_AUTH_SECRET}`) {
        return new Response('Unauthorized', {
            status: 401,
        });
    }

    const res = NextResponse.next()
    res.headers.append('Access-Control-Allow-Credentials', "true")
    res.headers.append('Access-Control-Allow-Origin', '*')
    res.headers.append('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT,OPTIONS')
    res.headers.append(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Authorisation, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )
    return res
}
 
export const config = {
    matcher: [
        '/memento/:uuid/check', 
        '/memento/:uuid/upload', 
        // '/memento/cron', // different env var
        '/memento/pay', 
    ],
}