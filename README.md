# ⚡ RAKIB IP INTELLIGENCE

<p align="center">

### 🌐 Privacy-Safe IP Intelligence & Visitor Analytics

**MongoDB • Real-Time SSE • Leaflet Maps • Device Detection • Cyber Glass UI**

</p>

---

## 🛰️ Overview

RAKIB IP INTELLIGENCE is a modern privacy-focused visitor analytics dashboard built with Node.js, Express, MongoDB and Leaflet.

It provides approximate IP-based network information, device and browser detection, persistent visitor history, geographic visualization and real-time visitor events through a futuristic cyber/glass interface.

> This system does not collect GPS coordinates or exact street addresses.

---

## ✨ Features

### 🌐 IP Intelligence

- Public IP detection
- Approximate country
- Region
- City
- Postal code
- Timezone
- ISP
- Organization
- ASN
- Approximate latitude and longitude

### 📱 Device Intelligence

Detects:

- Device type
- Device vendor
- Device model
- Operating system
- Browser
- Browser version
- Rendering engine
- User-Agent

### 🗺️ Geo Intelligence

Interactive Leaflet and OpenStreetMap visitor map.

Visitor markers can show:

- Country
- City
- Masked IP
- Approximate coordinates

---

## ⚡ Real-Time Visitor Stream

The dashboard uses Server-Sent Events (SSE) for real-time visitor updates.

    Visitor Browser
          |
          v
      /api/track
          |
          v
    Visitor Processing
          |
          v
       MongoDB
          |
          v
       SSE Event
          |
          v
     Live Dashboard

New visitor events can appear without refreshing the dashboard.

---

## 🔐 Protected Live Action

The Live Action panel is protected by administrator authentication.

The authentication credential is configured through an environment variable and is never stored inside the frontend code.

Configuration:

    LIVE_PASSWORD=YOUR_PRIVATE_PASSWORD

The server creates a temporary access token after successful authentication.

Live sessions automatically expire.

---

## ☁️ MongoDB Persistent Storage

Visitor history is stored in MongoDB instead of temporary server memory.

This means visitor history remains available after:

    Render Restart
          |
          v
    Server Restart
          |
          v
    New Deployment
          |
          v
       MongoDB
          |
          v
    History Available

The application automatically creates the required collection and indexes.

Collection:

    ip_visitors

---

## 🛡️ Privacy Design

This project is designed to avoid storing raw IP addresses.

The database stores:

    IP Hash
    +
    Masked IP

Example:

    Original:
    152.55.178.101

    Dashboard:
    152.55.178.xxx

The system does not intentionally store:

- Raw IP address
- GPS location
- Exact street address

Location information is based on approximate IP geolocation.

---

## 📊 Dashboard

The dashboard includes:

    +---------------------------------------------+
    |          RAKIB IP INTELLIGENCE              |
    +---------------------------------------------+
    | TOTAL | TODAY | COUNTRIES | LIVE CHANNEL   |
    +---------------------------------------------+
    |                                             |
    |                 VISITOR MAP                 |
    |                                             |
    +-------------------------+-------------------+
    | CURRENT VISITOR         | LAST SIGNAL       |
    +-------------------------+-------------------+
    |              EVENT STREAM                  |
    +---------------------------------------------+
    | COUNTRIES | DEVICES | ISP SIGNALS          |
    +---------------------------------------------+

---

## 📈 Analytics

The dashboard provides:

- Total visitors
- Today's visitors
- Countries
- Devices
- Browsers
- ISPs
- Visitor history
- Live visitor events
- Geographic map data

---

## 🚦 Rate Limiting

The tracker includes basic request protection.

Default:

    20 tracking requests / IP / minute

This helps reduce accidental or abusive request flooding.

---

## 🧠 Technology Stack

| Technology | Purpose |
|------------|---------|
| Node.js | Runtime |
| Express 5 | Web Server |
| MongoDB | Persistent Database |
| MongoDB Driver | Database Connection |
| UAParser.js | Device Detection |
| Leaflet | Interactive Map |
| OpenStreetMap | Map Tiles |
| IPWho.is | Approximate IP Geolocation |
| Server-Sent Events | Real-Time Events |
| HTML | Dashboard |
| CSS | Cyber UI |
| JavaScript | Frontend Logic |

---

## 📁 Project Structure

    rakib-ip-tracker/
    |
    +-- public/
    |   +-- index.html
    |   +-- style.css
    |   +-- app.js
    |
    +-- server.js
    +-- package.json
    +-- package-lock.json
    +-- .env
    +-- .gitignore
    +-- README.md

---

## ⚙️ Installation

Clone the repository:

    git clone YOUR_REPOSITORY_URL
    cd rakib-ip-tracker

Install dependencies:

    npm install

---

## 🔑 Environment Variables

Create a .env file.

Required variables:

    MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING
    MONGODB_DB=goatbot
    LIVE_PASSWORD=YOUR_PRIVATE_PASSWORD
    PORT=3000

Never commit .env to GitHub.

Make sure .gitignore contains:

    .env
    node_modules/

---

## ▶️ Run Locally

Start the server:

    npm start

Development mode:

    npm run dev

Open:

    http://localhost:3000

---

## ❤️ Health Check

Health endpoint:

    /health

Test:

    curl http://localhost:3000/health

Example response:

    {
      "success": true,
      "service": "Rakib IP Intelligence",
      "version": "3.0.0",
      "mongo": "online"
    }

---

# 🔌 API

## Track Visitor

    GET /api/track

This endpoint records the browser visitor and stores the privacy-safe visitor record in MongoDB.

---

## Visitor History

    GET /api/history

Optional:

    /api/history?limit=30

Returns recent visitor records.

---

## Statistics

    GET /api/stats

Returns:

- Total visitors
- Today's visitors
- Countries
- Devices
- Browsers
- ISPs

---

## Live Stream

    GET /api/live

Uses Server-Sent Events for real-time visitor events.

Example:

    event: visitor
    data: {...}

---

## Live Authentication

    POST /api/live/auth

Authentication is handled server-side.

The required credential must be configured through the LIVE_PASSWORD environment variable.

---

## Protected Live History

    GET /api/live/history

Requires an authorized temporary access token.

Example header:

    Authorization: Bearer YOUR_TOKEN

---

# 🚀 Render Deployment

Create a new Web Service on Render.

Recommended settings:

    Runtime:
    Node

    Build Command:
    npm install

    Start Command:
    npm start

Add these environment variables in Render:

    MONGODB_URI
    MONGODB_DB
    LIVE_PASSWORD

Do not upload .env to GitHub.

---

# 🗄️ MongoDB Atlas

Create a MongoDB Atlas cluster and database.

Recommended database:

    goatbot

Collection:

    ip_visitors

The application automatically creates the collection and required indexes when it starts.

---

# 🔒 Security

## MongoDB Credentials

Never expose your MongoDB connection string publicly.

If a MongoDB password has been exposed:

1. Change the MongoDB user's password.
2. Generate a new connection string.
3. Update MONGODB_URI.
4. Update the Render environment variable.
5. Redeploy the application.

## Environment Variables

Keep private credentials inside:

    .env

Never place credentials directly inside:

    server.js

or:

    public/app.js
    public/index.html

---

# ⚠️ Important Architecture

A Messenger bot cannot directly obtain a user's public IP simply because someone sends:

    ip

to the bot.

Messenger and Meta do not provide the sender's network IP to the bot.

The correct architecture is:

                USER
                  |
                  | Opens Tracker
                  v
             +----------+
             | BROWSER  |
             +----+-----+
                  |
                  v
          +---------------+
          | RAKIB TRACKER |
          +-------+-------+
                  |
        +---------+---------+
        |         |         |
        v         v         v
       IP       DEVICE     GEO
        |         |         |
        +---------+---------+
                  |
                  v
             +---------+
             | MongoDB |
             +----+----+
                  |
          +-------+-------+
          |               |
          v               v
      Dashboard        Live SSE

The bot should provide the tracker URL instead of calling /api/track itself.

This prevents the bot's own hosting IP from being recorded as a visitor.

---

# 🎨 Cyber Glass UI

The dashboard uses a custom futuristic interface featuring:

- Dark cyber theme
- Glass panels
- Neon borders
- Live indicators
- Interactive map
- Real-time event stream
- Protected Live Action
- Analytics cards
- Visitor intelligence
- Responsive mobile layout
- Desktop optimized layout

---

# 📡 Data Flow

                  +-------------+
                  |   VISITOR   |
                  +------+------+
                         |
                         v
                +----------------+
                | EXPRESS SERVER |
                +-------+--------+
                        |
             +----------+----------+
             |                     |
             v                     v
      +-------------+       +-------------+
      |  IP GEO API |       |  UA PARSER  |
      +------+------+       +------+------+
             |                     |
             +----------+----------+
                        |
                        v
                 +------------+
                 |  MONGODB   |
                 +------+-----+
                        |
              +---------+---------+
              |                   |
              v                   v
       +-------------+     +-------------+
       | DASHBOARD   |     |   LIVE SSE  |
       +-------------+     +-------------+

---

# 🧪 Development

Start development server:

    npm run dev

Check health:

    curl http://localhost:3000/health

Check history:

    curl http://localhost:3000/api/history

Check statistics:

    curl http://localhost:3000/api/stats

---

# 📦 Production

Start:

    npm start

The application listens on:

    0.0.0.0:3000

The PORT can be changed through environment variables.

---

# 🧹 Git

After making changes:

    git status
    git add .
    git commit -m "update tracker"
    git push origin main

---

# 👑 RAKIB IP INTELLIGENCE

    +------------------------------------------+
    |                                          |
    |       RAKIB IP INTELLIGENCE              |
    |                                          |
    |    NETWORK • DEVICE • GEO • LIVE         |
    |                                          |
    |          MONGODB POWERED                |
    |                                          |
    +------------------------------------------+

---

## ❤️ Credits

Built with ❤️ by Rakib

RAKIB // DIGITAL INTELLIGENCE SYSTEM

---

## 📜 License

This project is intended for legitimate analytics, development and educational purposes.

Use responsibly and respect applicable privacy laws, platform rules and user consent requirements.

