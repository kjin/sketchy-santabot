export interface EmailMessage {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  subject: string;
  body: string;
}

export const createRawEmail = (message: EmailMessage) =>
  [
    `From: ${message.fromName} <${message.fromAddress}>`,
    `To: ${message.toName} <${message.toAddress}>`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${message.subject}`,
    "",
    message.body.split("\n").join("<br>"),
  ].join("\n");

export const encodeEmail = (message: EmailMessage) =>
  Buffer.from(createRawEmail(message))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
