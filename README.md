# Path of Exile Discord Announcement Bot

This Discord bot fetches **Path of Exile** announcements from the official RSS feed and posts them into a Discord channel.

## 🚀 Features
- 📢 **Automatic Announcements**: Fetches new announcements and posts them.
- 🖼 **Embedded Messages**: Includes the title, description, category, and publication date.
- 📅 **Formatted Date**: Displays dates in a readable format.
- 🌐 **Includes Images**: Uses Path of Exile's logo in announcements.
- 🔗 **Clickable "Read More" Links**: Provides a direct link to the full announcement.

---

## 🛠️ Setup Instructions

### **1️⃣ Install Dependencies**
Ensure you have Node.js installed, then install the required packages:
```sh
npm install discord.js node-fetch@2 fs extra xml2js dotenv
```

### **2️⃣ Create a `.env` File**
Create a `.env` file in your project directory and add the following:
```
BOT_TOKEN=your_discord_bot_token
CHANNEL_ID=your_channel_id
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
| `CHANNEL_ID` | The Discord channel where announcements should be posted. |
| `RSS_FEED_URL` | The Path of Exile RSS feed URL. |

---

## 🏗 How It Works
1. The bot checks the **Path of Exile** RSS feed every **15 minutes**.
2. If a new announcement is found, it sends an **embedded message** to the Discord channel.
3. The bot **stores previously posted announcements** to prevent duplicate messages.

---

## ✨ Example Announcement
```
📢 Upcoming Changes in Path of Exile 2 0.1.1
📄 Later this week we will be releasing Path of Exile 2 0.1.1.
🔗 [Read More](https://www.pathofexile.com/forum/view-thread/3691520)
📅 Published: Mon, 03 Feb 2025
📂 Category: news
🖼 Image: Path of Exile Logo
```

---

## 📌 Future Enhancements
- ✅ Extract images from announcements instead of using the default logo.
- ✅ Format publication dates more human-friendly (e.g., `February 3, 2025`).
- ✅ Categorize announcements by type (e.g., Patch Notes, Events, Sales).

---

## 📜 License
This bot is open-source and free to use under the MIT License.

**Happy Grinding, Exiles!** 🎭🔥

