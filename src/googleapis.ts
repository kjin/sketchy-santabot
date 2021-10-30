import fs from "fs";
import readline from "readline";
import { Auth, google } from "googleapis";

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const tokenPath = (scopes: string[]) =>
  `auth/token-${scopes
    .map((x) => Buffer.from(x.split("/").slice(-1)[0]).toString("base64"))
    .join("-")}.json`;

export async function authorizeGoogleAPIs(
  scopes: string[]
): Promise<Auth.OAuth2Client> {
  // Load client secrets from a local file.
  const content = await fs.promises.readFile("auth/credentials.json", "utf8");
  // Authorize a client with credentials, then call the Google Sheets API.
  return await new Promise((res) =>
    authorize(scopes, JSON.parse(content), res)
  );
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(scopes, credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(tokenPath(scopes), "utf8", (err, token) => {
    if (err) return getNewToken(scopes, oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(scopes, oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err)
        return console.error(
          "Error while trying to retrieve access token",
          err
        );
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(tokenPath(scopes), JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log("Token stored to", tokenPath(scopes));
      });
      callback(oAuth2Client);
    });
  });
}
