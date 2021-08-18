<div align="center">
  <p>
    <img alt="CodeFactor Grade" src="https://img.shields.io/codefactor/grade/github/SinisterDeveloper/discord-moderation-bot/stable">
    <img alt="LICENSE" src="https://img.shields.io/github/license/SinisterDeveloper/discord-moderation-bot">
    <img alt="Version" src="https://img.shields.io/github/package-json/v/SinisterDeveloper/discord-moderation-bot">
    <img alt="CodeLines" src="https://img.shields.io/tokei/lines/github/SinisterDeveloper/discord-moderation-bot">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/SinisterDeveloper/discord-moderation-bot">
  </p>
</div>


# discord-moderation-bot

A customizable moderation bot made by [SinisterDev](https://discord.com/users/778140362790404158) to help Discord users, whether they are developers or normal users who want to improve their server.

### Important: 

This repository's [v1 branch](https://github.com/SinisterDeveloper/discord-moderation-bot/tree/v1) is deprecated, however it does not require you to have a database and you may still use it for the time being, however I will not be adding new features to the old version.

# Setup

## Prerequisites

* **[node.js](https://nodejs.org/en/)** - >Version 16.6+

## Clone the repository using Git or Github Desktop

Navigate to the folder in the terminal

```bash
cd <foldername>
```

## Dependencies

List of dependencies:
1. **[discord.js](https://www.npmjs.com/package/discord.js)** - The library we will be using  for interacting with the Discord API
2. **[mongoose](https://www.npmjs.com/package/mongoose)** - The library we will be using for managing our database operations

**Testing**: Run `npm install` to install all the dependenices if you are testing the bot locally 

**Production/Deployment**: Run `npm run build` to install dependencies if you are using the bot for production and/or if you are deploying

You can delete the `.github` folder. It is not required and only used for this repository's maintenance 

## Customizing `config.JSON`

### Bot Token

Replace `YOUR_BOT_TOKEN` with the actual token of your bot. If you don't know how to get your bot's token, [read this](https://www.writebots.com/discord-bot-token/).

### MongoDB Connection Uri

Fill the `MongoConnectionUrl` field with your MongoDB Cluster's Connection Uri. If you do not know how to fetch the uri string, please read **[here](https://docs.mongodb.com/guides/cloud/connectionstring/)**

### Prefix

Insert your desired prefix inside the `prefix` field.

### Default cooldown

Spam is something you generally want to avoid if you want your bot to function smoothly, the recommended default cooldown is `1 second`. **You can change the cooldown per command** in the command files by changing the `cooldown` key. If there is no cooldown key set, it will be set to 1 second.

Your `config.JSON` should look something like this:

```json
{
    "token": "YOUR_BOT_TOKEN", 
    "prefix": ",",
    "MongoConnectionUrl": "some-uri-here",
    "defaultCooldown": 1
}
```
## Running the bot

### Testing

If you are running the bot as a test, please run:

```bash
npm run dev
```

### Deployment

If you are deploying the bot or using it for production, please run:

```
npm run deploy
```

The bot should come online within a few seconds if you did the above steps correctly.

# Video Tutorial

Due to some confusion regarding the bot setup, I have made a video which will assist you on setting it up

# Support

If you need help, kindly open an issue and I'll help, alternatively you can DM me on Discord `SinisterDev#2006`. But opening an issue would be better.



https://user-images.githubusercontent.com/80232412/129895905-17a3e0b8-1a94-48a6-a257-d6541d8dfe5f.mp4



# Contributions

I am always open to contributions! If you feel anything is missing, or you want to add a command/feature, please open a Pull Request.
