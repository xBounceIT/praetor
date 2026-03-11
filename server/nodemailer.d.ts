declare module 'nodemailer' {
  interface SentMessageInfo {
    messageId: string;
  }

  interface Transporter {
    sendMail(options: unknown): Promise<SentMessageInfo>;
    verify(): Promise<boolean>;
  }

  interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    ignoreTLS?: boolean;
    auth?: { user: string; pass: string };
    tls?: { rejectUnauthorized: boolean };
  }

  export function createTransport(options: TransportOptions): Transporter;
}
