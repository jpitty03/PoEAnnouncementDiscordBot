# Path of Exile Discord Announcement Bot

This Discord bot fetches **Path of Exile** announcements from the official RSS feed and posts them into a Discord channel.

## 🚀 Features
- 📢 **Automatic Announcements**: Fetches new announcements and posts them.
- 🖼 **Embedded Messages**: Includes the title, description, category, and publication date.
- 📅 **Formatted Date**: Displays dates in a readable format.
- 🌐 **Includes Images**: Uses Path of Exile's logo in announcements.
- 🔗 **Clickable "Read More" Links**: Provides a direct link to the full announcement.

---

## 🛠️ Quick Setup For Your Own Discord Server

### **1️⃣ Follow the link below**
> [Install PoE Announcements](https://discord.com/oauth2/authorize?client_id=1336092556987207791&scope=bot%20applications.commands&permissions=0)
>
> Message me on Discord for support (IceTown), or join our [Discord](https://discord.gg/DcstwdqbGP)
---

## Commands (Mods Only)

> **Note:**  
> Only moderators/admins in your server can use these commands. Non-admin users will not receive any responses.
>
> A moderator must have one of these permissions: **Administrator, ManageChannels, ManageMessages, or KickMembers**

### `!setpoechannel #channel`
Sets the channel where the Path of Exile announcements will be posted.

- **Usage:**  In any text channel, type: !setpoechannel #news
  Replace `#news` with the channel you want to use. The bot will confirm the update with a success message.

#### `!setpoetag <tag>`
Sets a custom tag that will be included with every announcement posted in your server. This can be used to mention a specific role (e.g., `@poe-news`) or simply to add a custom prefix..

- **Usage:**  Simply type: !setpoetag `@poe-news`
  Replace `@poe-news` with the desired tag. Ensure that the announcements channel is set before using this command.

#### `!togglex`
Toggles the ability to receive Twitter/X posts in set channel.

- **Usage:**  Simply type: !togglex

#### `!poenewshelp`
Displays a list of available admin commands.

- **Usage:**  Simply type: !poenewshelp

---

## 🛠️ Setup Instructions to Run Your Own

### **1️⃣ Install Dependencies**
Ensure you have Node.js installed, then install the required packages:
```sh
npm install discord.js node-fetch@2 fs extra xml2js dotenv
```

### **2️⃣ Create a `.env` File**
Create a `.env` file in your project directory and add the following:
```
BOT_TOKEN=your_discord_bot_token
```

### **3️⃣ Run the Bot**
```sh
node bot.js
```

---

## 📝 Configuration
| **Option**   | **Description**  |
|-------------|-----------------|
| `BOT_TOKEN` | Your Discord bot token (from Discord Developer Portal). |
| `RSS_FEED_URL` | The Path of Exile RSS feed URL. |

---

## 🏗 How It Works
1. The bot checks the **Path of Exile** RSS feed every **15 minutes**.
2. If a new announcement is found, it sends an **embedded message** to the Discord channel.
3. The bot **stores previously posted announcements** to prevent duplicate messages.

---

## ✨ Example Announcement
![Announcement Example](https://github.com/jpitty03/PoEAnnouncementDiscordBot/blob/main/poe-announcement.png)
---

## 📌 Future Enhancements
- ✅ Extract images from announcements instead of using the default logo.
- ✅ Format publication dates more human-friendly (e.g., `February 3, 2025`).
- ✅ Categorize announcements by type (e.g., Patch Notes, Events, Sales).

---

## 📜 License
This bot is open-source and free to use under the MIT License.

**Happy Grinding, Exiles!** 🎭🔥

