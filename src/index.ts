import * as rl from "readline";
import { google } from "googleapis";
import { Arrangement, SantaBot } from "./common/santa";
import { scoring } from "./common/scoring";
import { authorizeGoogleAPIs } from "./googleapis";
import { readFile } from "fs/promises";
import { createRawEmail, EmailMessage, encodeEmail } from "./common/email";
import { OAuth2Client } from "google-auth-library";

/**
 * Scopes need for Sketchy Santabot to work.
 * If modifying these scopes, delete token.json.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

/**
 * The shape of the config to use.
 */
interface Config {
  /**
   * The name to use in the From: field of the assignment email.
   */
  fromName: string;
  /**
   * The email address from which the assignment email should be sent.
   * When the program prompts for an authorization token from a specific
   * Google account, use the account associated with this email.
   */
  fromAddress: string;
  /**
   * Data sources used to generate assignments and draft emails.
   */
  data: {
    /**
     * Form responses from a survey. It should have 3 columns with headers
     * included, representing:
     * Timestamp | Email | Wishlist
     */
    surveySheet: SpreadsheetRange;
    /**
     * A map of names to emails. All names and emails in other sheets must
     * match these values (emails can be case-insensitive). It should have 2
     * columns with headers included, representing:
     * Name | Email
     */
    emailSheet: SpreadsheetRange;
    /**
     * A history of participants' assignments for previous Secret Santas.
     * Use "----" (exactly) to represent no participation for a given year.
     * If should have N+1 columns (where N is the number of previous events)
     * with headers included, representing:
     * Gifter | Year N Recipient | Year N-1 Recipient | ...
     */
    historySheet: SpreadsheetRange;
    /**
     * The email template. It should contain a single cell that contains the
     * body of the template in its entirety. Template substitutions are denoted
     * with angle brackets enclosing a key (<Key>). For a list of keys, see the
     * SketchySantaTemplateReplacements interface.
     */
    emailTemplateSheet: SpreadsheetRange;
  };
  /**
   * The directory to be used to store authorization tokens to Google APIs,
   * relative to the current working directory.
   * It should already contain a file named credentials.json which enables
   * access to SCOPES.
   * If omitted, a directory named "auth" in the current working directory
   * is used.
   */
  authDir?: string;
  /**
   * The year that should be displayed in the assignment email.
   * If omitted, the current year is used.
   */
  year?: number;
  /**
   * The random seed. Running the program with the same seed and
   * number of iterations will yield the same assignments.
   * A special value of -1 will cause the seed to be calculated
   * based on input data (specifically, the combined length of
   * all of the participants' wishlists).
   * If omitted, -1 is used.
   * This can also be overridden at the command line as the 2nd positional
   * argument.
   */
  seed?: number;
  /**
   * The number of assignments to generate.
   * If omitted, 10000 is used.
   * This can also be overridden at the command line as the 3rd positional
   * argument.
   */
  iterations?: number;
}

/**
 * Specifies a range within a spreadsheet.
 */
interface SpreadsheetRange {
  /**
   * The ID of the spreadsheet to retrieve data from.
   * It should be a 44-char base64 string.
   */
  spreadsheetId: string;
  /**
   * The A1 notation or R1C1 notation of the range to retrieve values from.
   * This is commonly expressed as "Sheet1!A1:B2", for example.
   */
  range: string;
}

/**
 * Case-sensitive keys used for email template substitutions.
 */
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

/**
 * Run Sketchy Santabot.
 * It randomly generates a specified number of arrangements, picks the best
 * one, drafts emails based on this arrangement, and prompts the user to send
 * emails.
 * Helpful information (including the draft bodies) is printed on stdout, so
 * it may be useful to pipe this to a file.
 * By default, the bot will send emails to itself. To actually send to
 * participants, set the env var SEND_EMAILS_FOR_REAL to "yes".
 */
async function main(args: string[]) {
  if (!args[0]) {
    console.error(
      `Usage: npm start path/to/config.json [seedOverride] [iterationsOverride]`
    );
    process.exit(1);
  }
  const config: Required<Config> = JSON.parse(await readFile(args[0], "utf8"));
  config.seed = Number(args[1]) || (config.seed ?? -1);
  config.iterations = Number(args[2]) || (config.iterations ?? 10000);
  config.year = config.year ?? new Date().getFullYear();
  config.authDir = config.authDir ?? "./auth";

  let auth: OAuth2Client;
  try {
    auth = await authorizeGoogleAPIs(config.authDir, SCOPES);
  } catch (e) {
    console.error(
      `An issue was encountered while authorizing the current user.`
    );
    console.error(
      `You may be able to resolve it by deleting all tokens in ${config.authDir}`
    );
    console.error(`Original error: ${e}`);
    process.exit(1);
  }
  const sheets = google.sheets({ version: "v4", auth });

  const wishlistMap = new Map();
  let wishlistTotalLength = 0; // To be used to create a seed
  {
    const res = await sheets.spreadsheets.values.get(config.data.surveySheet);
    const surveyData = res.data.values.slice(1) as string[][];
    for (const [, email, wishlist] of surveyData) {
      // Assumes that emails are not case-sensitive.
      wishlistMap.set(email.toLowerCase(), wishlist);
      wishlistTotalLength += wishlist.length;
    }
  }
  if (config.seed === -1) {
    config.seed = wishlistTotalLength;
  }
  console.error(`Fetched form responses from ${wishlistMap.size} people`);

  const recipientToEmail = new Map();
  const emailToRecipient = new Map();
  {
    const res = await sheets.spreadsheets.values.get(config.data.emailSheet);
    const emails = res.data.values.slice(1) as string[][];
    for (const [recipient, email] of emails) {
      recipientToEmail.set(recipient, email);
      emailToRecipient.set(email, recipient);
    }
  }
  console.error("Fetched email addresses");

  for (const [email] of wishlistMap) {
    if (!emailToRecipient.has(email)) {
      throw new Error(`Unknown email: ${email}`);
    }
  }
  console.error("Validated email addresses");

  let arrangement!: Arrangement;
  let foundOptimal: boolean;
  {
    const res = await sheets.spreadsheets.values.get(config.data.historySheet);
    const bot = new SketchySantaBot(res.data.values);
    const participants = [...wishlistMap].map(
      ([email]) => emailToRecipient.get(email)!
    );
    const optimalArrangements = bot.getNumOptimalArrangements(
      config.seed,
      config.iterations,
      scoring,
      participants
    );
    arrangement = bot.generateBestArrangement(
      config.seed,
      config.iterations,
      scoring,
      participants
    );
    foundOptimal = optimalArrangements > 0;
    console.log(
      `${optimalArrangements}/${config.iterations} optimal arrangements`
    );
    console.log(`--- First optimal (or best) arrangement ---`);
    console.log(bot.stagedArrangementToString(arrangement, scoring));
    console.log();
  }
  console.error(
    `Generated ${foundOptimal ? "" : "non-"}optimal secret santa arrangement`
  );

  const emails: EmailMessage[] = [];
  {
    const res = await sheets.spreadsheets.values.get(
      config.data.emailTemplateSheet
    );
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
        Organizer: config.fromName,
        Year: `${config.year}`,
      });
      emails.push({
        fromName: config.fromName,
        fromAddress: config.fromAddress, // Will get replaced anyway
        toName: giver,
        toAddress:
          (process.env.SEND_EMAILS_FOR_REAL || "").toLowerCase() === "yes"
            ? recipientToEmail.get(giver)!
            : config.fromAddress,
        subject: `Secret Santa ${config.year}`,
        body,
      });
    }
  }
  console.error("Generated email bodies");

  const previews = [];
  for (const email of emails) {
    previews.push(["======", createRawEmail(email), "======"].join("\n"));
  }
  console.log(previews.join("\n\n"));
  console.error("Output email previews");

  await new Promise<void>((res) => {
    const prompt = rl.createInterface({
      input: process.stdin,
      output: process.stderr,
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
    console.error(`--- Response for email sent to ${email.toAddress} ---`);
    console.error(res.data);
  }
  console.error("Emails sent");
}

main(process.argv.slice(2));
