# discord-moderation-bot
### A customizable moderation bot made by SinisterDev to help Discord users, whether they are developers or normal users who want to improve their server

# Setup - Very Important
## Prerequisites
* **[node.js](https://nodejs.org/en/)**
## Clone the repository using Git or Github Desktop
Navigate to the folder in the terminal
```bash
cd <foldername>
```
## Dependencies
List of dependencies:
1. **[discord.js](https://www.npmjs.com/package/discord.js)** - The library we will be using  for interacting with the Discord API
2. **[ms](https://www.npmjs.com/package/ms)** - Very useful and important utility for converting time

Use `npm install` to install all the dependenices. 

You can delete the `.github` folder. It is not required and only used for this repository's maintenance 

## Customizing `config.JSON`
### Bot Token
Replace `YOUR_BOT_TOKEN` with the actual token of your bot. If you don't know how to get your bot's token, [read this](https://www.writebots.com/discord-bot-token/).
### Prefix
Insert your desired prefix inside the `prefix` field
### Default cooldown
Spam is something you generally want to avoid if you want your bot to function smoothly, the recommended default cooldown is `1 second`. **You can change the cooldown per command** in the command files by changing the `cooldown` key. If there is no cooldown key set, it will be set to 1 second.

Your `config.JSON` should look something like this:
```json
{
    "token": "YOUR_BOT_TOKEN", 
    "prefix": ",",
    "defaultCooldown": 1
}
```
## Running the bot
Add the bot to your server and run:
```
node .
```
The bot should come online within a few seconds if you did the above steps correctly.

# Support
If you need help, kindly open an issue and I'll help, alternatively you can DM me on Discord `SinisterDev#2006`. But opening an issue would be better

# Contributions
I am always open to contributions! If you feel anything is missing, or you want to add a command/feature, please open a Pull Request.

# Extra
## VPS
If you do not want to locally host the bot and want it to be all/most of the day, you may require a VPS(Virtual Private Server. However most of them aren't free to use. Here are a few free VPS you can use:
### **[Replit](https://replit.com/~)**
When I first started out, I used [repl.it](https://replit.com/~) to host my small bot, however whener you close the browser window, your application sleeps, causing the bot to stop running. A way to always keep your bot online is by pinging the application every 5 minutes using a 3rd party website called [Uptime Robot](https://uptimerobot.com/).

**AnIdiotsGuide made a post on how to host the bot on repl.it**. Please read the guide [here](https://anidiots.guide/hosting/repl)

### **[Heroku](https://dashboard.heroku.com/)**
Heroku is designed to run web applications made with Flask, Django etc but it is possible to host the bot there if it doesn't require too many resources. I haven't used Heroku before, but you can read about it [here](https://anidiots.guide/hosting/heroku)




