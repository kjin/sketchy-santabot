import * as rl from "readline";
import { google } from "googleapis";
import { Arrangement, SantaBot } from "./common/santa";
import { scoring } from "./common/scoring";
import { authorizeGoogleAPIs } from "./googleapis";

// If modifying these scopes, delete token.json.
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

const FROM_NAME = "Sketchy SantaBot";
const FROM_ADDRESS = "sketchy.santabot@gmail.com";
const YEAR = 2021;

const SURVEY_SHEET = {
  spreadsheetId: "1UyDrGXVHIF6npuGohRAxi8l-nwKW8L0UQOo1jZ_f75M",
  range: "Form Responses 1!A1:C100",
};

const EMAIL_SHEET = {
  spreadsheetId: "1BXCGg4Ja4BpUbfhbHhhRSkZGK936rrPYF0fJIfdClM0",
  range: "Emails!A1:D100",
};

const HISTORY_SHEET = {
  spreadsheetId: "1BXCGg4Ja4BpUbfhbHhhRSkZGK936rrPYF0fJIfdClM0",
  range: "History!A1:D100",
};

const EMAIL_TEMPLATE_SHEET = {
  spreadsheetId: "1BXCGg4Ja4BpUbfhbHhhRSkZGK936rrPYF0fJIfdClM0",
  range: "Email Template!A1:A1",
};

interface SketchySantaTemplateReplacements {
  Santa: string;
  Recipient: string;
  "Recipient email": string;
  "Recipient wishlist": string;
  Organizer: string;
  Year: string;
}

class SketchySantaBot extends SantaBot {
  constructor(data: any[][]) {
    super();
    const input = data.slice(1) as string[][];
    for (const [giver, ...recipients] of input) {
      if (!giver) break;
      recipients.reverse();
      for (let i = 0; i < recipients.length; i++) {
        if (!recipients[i]) break;
        if (recipients[i] === "----") {
          recipients[i] = null;
        }
      }
      this.participants.set(giver, recipients);
    }
  }
}

function replaceInString<T>(str: string, substitutions: T): string {
  for (const [key, value] of Object.entries(substitutions)) {
    str = str.split(`<${key}>`).join(value);
  }
  return str;
}

interface EmailMessage {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  subject: string;
  body: string;
}

const createRawEmail = (message: EmailMessage) =>
  [
    `From: ${message.fromName} <${message.fromAddress}>`,
    `To: ${message.toName} <${message.toAddress}>`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${message.subject}`,
    "",
    message.body.split("\n").join("<br>"),
  ].join("\n");

const encodeEmail = (message: EmailMessage) =>
  Buffer.from(createRawEmail(message))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function main(args: string[]) {
  let seed = Number(args[0]) || -1;
  const iterations = Number(args[1]) || 10000;

  const auth = await authorizeGoogleAPIs(SCOPES);
  const sheets = google.sheets({ version: "v4", auth });

  const wishlistMap = new Map();
  let wishlistTotalLength = 0; // To be used to create a seed
  {
    const res = await sheets.spreadsheets.values.get(SURVEY_SHEET);
    const surveyData = res.data.values.slice(1) as string[][];
    for (const [, email, wishlist] of surveyData) {
      wishlistMap.set(email, wishlist);
      wishlistTotalLength += wishlist.length;
    }
  }
  if (seed === -1) {
    seed = wishlistTotalLength;
  }
  console.log(`Fetched form responses from ${wishlistMap.size} people`);

  const recipientToEmail = new Map();
  const emailToRecipient = new Map();
  {
    const res = await sheets.spreadsheets.values.get(EMAIL_SHEET);
    const emails = res.data.values.slice(1) as string[][];
    for (const [recipient, email] of emails) {
      recipientToEmail.set(recipient, email);
      emailToRecipient.set(email, recipient);
    }
  }
  console.log("Fetched email addresses");

  for (const [email] of wishlistMap) {
    if (!emailToRecipient.has(email)) {
      throw new Error(`Unknown email: ${email}`);
    }
  }
  console.log("Validated email addresses");

  let arrangement!: Arrangement;
  {
    const res = await sheets.spreadsheets.values.get(HISTORY_SHEET);
    const bot = new SketchySantaBot(res.data.values);
    const participants = [...wishlistMap].map(
      ([email]) => emailToRecipient.get(email)!
    );
    const optimalArrangements = bot.getNumOptimalArrangements(
      seed,
      iterations,
      scoring,
      participants
    );
    arrangement = bot.generateBestArrangement(
      seed,
      iterations,
      scoring,
      participants
    );
    console.error(`${optimalArrangements}/${iterations} optimal arrangements`);
    console.error(`--- First optimal (or best) arrangement ---`);
    console.error(bot.stagedArrangementToString(arrangement, scoring));
    console.error();
  }
  console.log("Generated secret santa arrangement");

  const emails: EmailMessage[] = [];
  {
    const res = await sheets.spreadsheets.values.get(EMAIL_TEMPLATE_SHEET);
    const template = res.data.values[0][0];
    for (const [giver, receiver] of arrangement) {
      const body = replaceInString<SketchySantaTemplateReplacements>(template, {
        Santa: giver.split(" ")[0], // Remove last initials
        Recipient: `<b>${receiver}</b>`,
        "Recipient email": recipientToEmail.get(receiver)!,
        "Recipient wishlist": wishlistMap
          .get(recipientToEmail.get(receiver)!)!
          .trim()
          .split("\n")
          .map((x) => `<b>${x}</b>`)
          .join("\n"),
        Organizer: FROM_NAME,
        Year: `${YEAR}`,
      });
      emails.push({
        fromName: FROM_NAME,
        fromAddress: FROM_ADDRESS, // Will get replaced anyway
        toName: giver,
        toAddress:
          (process.env.SEND_EMAILS_FOR_REAL || "").toLowerCase() === "yes"
            ? recipientToEmail.get(giver)!
            : FROM_ADDRESS,
        subject: `Secret Santa ${YEAR}`,
        body,
      });
    }
  }
  console.log("Generated email bodies");

  const previews = [];
  for (const email of emails) {
    previews.push(["======", createRawEmail(email), "======"].join("\n"));
  }
  console.error(previews.join("\n\n"));
  console.log("Output email previews");

  await new Promise<void>((res) => {
    const prompt = rl.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    prompt.question("-> Press Enter to send emails", () => {
      prompt.close();
      res();
    });
  });
  const gmail = await google.gmail({ version: "v1", auth });
  for (const email of emails) {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodeEmail(email),
      },
    });
    console.log(`--- Response for email sent to ${email.toAddress} ---`);
    console.log(res.data);
  }
  console.log("Emails sent");
}

main(process.argv.slice(2));
