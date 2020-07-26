require("dotenv").config();

const { App } = require("@slack/bolt");
const fetch = require("node-fetch");
const streamPipeline = require("util").promisify(require("stream").pipeline);
const FormData = require("form-data");
const fs = require("fs");
const Jimp = require("jimp");
const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_OAUTH_TOKEN,
});

const slackUrlRegex = /(?:https:\/\/slack\-files\.com)\/(.+)\-(.+)\-(.+)/i;
const fileTypeRegex = /(JPEG|JPG|PNG|BMP|TIFF|HEIC)/gi;
//downloads file from slack
const getPrivateFile = async (url) => {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_OAUTH_TOKEN}`,
    },
  });
  console.log(await res);
  return await res;
};

const writeTempFile = async (fetchRes, fileName) => {
  //takes in buffer and writes to file
  await streamPipeline(fetchRes.body, fs.createWriteStream(`./${fileName}`));
  //turn image into formData
  const buffer = fs.createReadStream(`./${fileName}`);
  let formData = new FormData();
  formData.append("file", buffer);
};

const uploadToSlack = async (fileName) => {
  console.log(`uploading file ${fileName}!`);
  const slackUploadRes = await app.client.files.upload({
    token: process.env.SLACK_USER_OAUTH_TOKEN,
    file: fs.readFileSync(`./${fileName}`),
    filename: fileName,
  });
  console.log("sharing file");
  //share public link to slack
  const slackShareRes = await app.client.files.sharedPublicURL({
    token: process.env.SLACK_USER_OAUTH_TOKEN,
    file: await slackUploadRes.file.id,
  });
  const permalink = await slackShareRes.file.permalink_public;
  const slackFileLink = await slackUrlRegex.exec(await permalink);
  // [1] - team id | [2] - file id | [3] - pub_secret

  //delete file
  fs.unlinkSync(`./${fileName}`);
  //return public link
  const pubLink = `https://files.slack.com/files-pri/${slackFileLink[1]}-${
    slackFileLink[2]
  }/${fileName.replace(/ /g, "_").toLowerCase()}?pub_secret=${
    slackFileLink[3]
  }`;
  return pubLink;
};

const convertImage = async (fileName, nameNoExt, newType) => {
  try {
    console.log(`converting file ${fileName} (${nameNoExt}) to ${newType} `);
    const file = await Jimp.read(fileName);
    await file.writeAsync(`${nameNoExt}.${newType}`);
    fs.unlinkSync(fileName);
  } catch (err) {
    fs.unlinkSync(fileName);
    throw err;
  }
};

app.message(fileTypeRegex, async ({ message, say }) => {
  try {
    console.log(message);
    if (typeof message.files === "undefined") {
      throw "NoFilesError";
    }
    const fileUrl = await message.files[0].url_private;
    console.log(`Downloading file ${await fileUrl}`);
    const file = await getPrivateFile(await fileUrl);

    let fileType = fileTypeRegex.exec(message.text);
    fileType = fileType[1].toLocaleLowerCase();

    const fileName = await message.files[0].name.replace(/ /g, "_");
    const fileNameRegexRun = /([A-z0-9\s]+)\.(?:[A-z])/i.exec(await fileName);
    const fileNameNoExt = await fileNameRegexRun[1].replace(/ /g, "_");

    await writeTempFile(file, fileName);
    await convertImage(await fileName, await fileNameNoExt, fileType);
    const upload = await uploadToSlack(`${await fileNameNoExt}.${fileType}`);
    console.log(upload);

    //shitty way to delete original file

    await say({
      text: `Here's your ${fileType}! ${upload}`,
      thread_ts: message.ts,
    });
  } catch (err) {
    console.error(err);
    say({
      text: `Sorry, we experienced an error (${err}). Try again?`,
      thread_ts: message.ts,
    });
  }
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("started bolt");
})();
