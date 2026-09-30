# ⚡ RAKIB IP INTELLIGENCE

## 🌐 Privacy-Safe Visitor Intelligence & Server Analytics

MongoDB • Express 5 • Real-Time SSE • Leaflet • IP Intelligence • Session Analytics • Server Telemetry • Cyber Glass UI

---

## 🛰️ Overview

RAKIB IP INTELLIGENCE is a modern privacy-conscious visitor analytics and server intelligence platform built with Node.js, Express 5, MongoDB, UAParser.js, Leaflet, OpenStreetMap and IPWho.is.

The system provides approximate IP-based network intelligence, device detection, geographic visualization, visitor history, real-time visitor events, session analytics, page analytics, request monitoring, security telemetry and server health monitoring.

> IP-based geographic information is approximate and should not be treated as an exact physical location.

The system does not intentionally collect GPS coordinates, IMEI, SIM information, contacts, files, camera data or microphone data.

---

# ✨ Features

## 🌐 IP Intelligence

- Public IP detection
- AES-256-GCM encrypted IP storage
- IP hash
- Masked IP
- Country
- Country code
- Region
- City
- Postal code
- Timezone
- ISP
- Organization
- ASN
- Approximate latitude
- Approximate longitude

## 📱 Device Intelligence

- Device type
- Device vendor
- Device model
- Operating system
- OS version
- Browser
- Browser version
- Rendering engine
- User-Agent

## 🧠 Client Intelligence

Browser-provided technical signals can include:

- Screen resolution
- Viewport size
- Device pixel ratio
- Color depth
- Touch support
- Touch points
- Hardware concurrency
- Device memory
- Browser language
- Browser language list
- Timezone
- Timezone offset
- Cookies availability
- Do Not Track
- Online status
- Platform
- Network connection information
- WebGL information
- Canvas fingerprint signal

These signals are intended for analytics and technical diagnostics.

## 🗺️ Geo Intelligence

Interactive geographic visualization powered by Leaflet and OpenStreetMap.

Visitor map information can include:

- Country
- City
- Masked IP
- Approximate coordinates
- Network/security signals

IP geolocation is approximate and may not represent the visitor's exact physical location.

---

# ⚡ Real-Time Visitor Stream

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
 Broadcast Event
      |
      v
    SSE
      |
      v
Live Dashboard

New visitor events can appear without manually refreshing the dashboard.

---

# 👥 Session Intelligence

The server maintains temporary visitor sessions.

Session analytics include:

- Session ID
- First activity
- Last activity
- Request count
- First path
- Active session count
- Returning visitor detection
- Session activity
- Session detail

Session cookies are:

- HTTP-only
- SameSite protected
- Temporary
- Automatically expired

Default session inactivity window:

30 minutes

---

# 🧭 Visitor Journey

Visitor activity can be associated with a session.

Example:

Visitor
   |
   +-- /
   |    |
   |    +-- 4.2s
   |
   +-- /dashboard
   |    |
   |    +-- 8.7s
   |
   +-- /api/track
   |
   +-- Exit

Page analytics can record:

- Page path
- Page title
- Session ID
- Visit time
- Page duration
- Referrer

---

# 📄 Page Analytics

Page-view endpoint:

POST /api/analytics/pageview

Provides:

- Total page views
- Popular pages
- Average page duration
- Session-based page activity
- Page ranking

Example request:

{
  "path": "/",
  "title": "Rakib IP Intelligence",
  "duration": 4200
}

---

# 📡 Request Analytics

The server records technical request telemetry.

Tracked information can include:

- HTTP method
- Endpoint
- Response status
- Response time
- Session ID
- Referrer
- User-Agent
- Request timestamp

Endpoint:

GET /api/analytics/requests

Runtime analytics include:

- Total requests
- Request errors
- Error rate
- Average response time
- HTTP status distribution
- Top endpoints

Static assets are excluded from persistent request analytics to reduce unnecessary database noise.

---

# 🛡️ Security Telemetry

The server provides lightweight technical security monitoring.

Possible events include:

- 404 Not Found
- 401 Unauthorized
- 403 Forbidden
- 429 Rate Limited
- Suspicious Path
- Unusual HTTP Method

Common suspicious-path probes can include:

- .env
- .git
- wp-admin
- wp-login
- phpmyadmin
- xmlrpc.php
- config.php

> These signals are technical telemetry only. A security event does not automatically mean that a visitor is malicious.

Security endpoint:

GET /api/analytics/security

---

# 🖥️ Server Intelligence

The dashboard includes runtime/server telemetry.

Metrics include:

- Server uptime
- Node.js version
- Platform
- Architecture
- Process ID
- Hostname
- CPU count
- CPU load
- RAM usage
- Heap usage
- System memory
- Total requests
- Error count
- Error rate
- Average response time
- Active sessions
- Last request time

Endpoint:

GET /api/server-health

Example:

SERVER INTELLIGENCE

UPTIME       2d 14h 22m
RAM          148 MB
CPU LOAD     0.42
REQUESTS     18,492
ERROR RATE   0.18%
SESSIONS     27

---

# 📊 Analytics Overview

Main analytics endpoint:

GET /api/analytics/overview

Provides:

Runtime:
- Total requests
- Errors
- Average response time
- Active sessions

Last 24 Hours:
- Requests
- Page views
- Sessions
- Security events
- Returning visitors
- Unique visitors

Request Intelligence:
- Top endpoints
- HTTP status distribution

---

# 🔎 Session Analytics

Session list:

GET /api/analytics/sessions

Optional:

GET /api/analytics/sessions?limit=100

Individual session:

GET /api/analytics/session/:sessionId

A session detail can contain:

Session
 Session information
 Page views
 Requests
 Visitor records

---

# 📈 Page Analytics

Endpoint:

GET /api/analytics/pages

Returns page popularity and average page duration.

---

# 🔐 Protected Dashboard

Administrative analytics endpoints require administrator authentication.

Protected areas include:

/api/history
/api/stats
/api/live
/api/server-health
/api/analytics/*

The administrator credential is configured through an environment variable.

Example:

LIVE_PASSWORD=YOUR_PRIVATE_PASSWORD

Never place the password inside:

public/app.js
public/index.html
README.md

---

# 🔒 Privacy Design

The system is designed with privacy-conscious storage.

The database uses:

Encrypted IP
     +
IP Hash
     +
Masked IP

Example:

Original:
152.55.178.101

Dashboard:
152.55.178.xxx

The encrypted IP can only be decrypted by the server using the configured encryption key.

The system does not intentionally store:

- GPS coordinates
- Exact street address
- IMEI
- SIM information
- Contacts
- Personal files
- Camera content
- Microphone content

---

# 🔑 Encryption

Required environment variable:

IP_ENCRYPTION_KEY=64_HEX_CHARACTERS

Example format:

0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

> Do not change the encryption key after production data has been stored unless you have a proper migration/decryption plan.

---

# 📊 Dashboard

The dashboard contains:

RAKIB IP INTELLIGENCE

TOTAL | LIVE | COUNTRIES | DEVICES | RISK

LIVE WORLD MAP

TRAFFIC CHART | LIVE ACTIVITY

SECURITY MONITOR | VISITOR INTELLIGENCE

COUNTRIES | DEVICES | BROWSERS | NETWORK SIGNALS

SERVER INTELLIGENCE

RAM | CPU | REQUESTS | SESSIONS | ERRORS | UPTIME

---

# 🎨 Cyber Intelligence UI

The interface includes:

- Dark cyber theme
- Glassmorphism panels
- Neon highlights
- Live status indicators
- Animated activity feed
- Interactive world map
- Traffic chart
- Security monitor
- Visitor profile
- Analytics rankings
- Server telemetry
- Responsive mobile layout
- Desktop optimized layout
- Theme switching
- JSON/CSV export

---

# 📤 Data Export

The dashboard supports analytics export.

Available formats:

- JSON
- CSV

Useful for:

- Development
- Analytics
- Debugging
- Reporting

---

# 🗄️ MongoDB Storage

MongoDB provides persistent storage.

The application automatically creates the required collections and indexes.

Collections:

ip_tracker_visitors
ip_tracker_sessions
ip_tracker_pageviews
ip_tracker_requests
ip_tracker_security

Visitor collection:

ip_tracker_visitors

Stores visitor intelligence and historical visitor records.

Session collection:

ip_tracker_sessions

Stores visitor session analytics.

Page View collection:

ip_tracker_pageviews

Stores page-view analytics.

Request collection:

ip_tracker_requests

Stores technical request telemetry.

Security collection:

ip_tracker_security

Stores technical security events.

---

# 🧱 Project Structure

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
+-- render.yaml
+-- README.md
+-- LICENSE
+-- .gitignore
+-- .env

---

# 🧠 Technology Stack

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

# ⚙️ Installation

Clone the repository:

git clone YOUR_REPOSITORY_URL
cd rakib-ip-tracker

Install dependencies:

npm install

---

# 🔑 Environment Variables

Create:

.env

Required variables:

MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING
MONGODB_DB=goatbot
LIVE_PASSWORD=YOUR_PRIVATE_PASSWORD
IP_ENCRYPTION_KEY=YOUR_64_HEX_CHARACTER_KEY
LIVE_SESSION_SECRET=YOUR_RANDOM_SECRET
PORT=3000

Never commit .env.

Recommended .gitignore:

.env
node_modules/
*.log

---

# ▶️ Run Locally

Start:

npm start

The server listens on:

0.0.0.0:3000

Open:

http://localhost:3000

---

# ❤️ Health Check

Endpoint:

GET /health

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

# 🔌 API Reference

GET    /api/track
POST   /api/track

GET    /api/history-preview
GET    /api/history
GET    /api/stats

GET    /api/live

GET    /api/server-health

GET    /api/analytics/overview
GET    /api/analytics/requests
GET    /api/analytics/sessions
GET    /api/analytics/session/:sessionId
GET    /api/analytics/pages
POST   /api/analytics/pageview
GET    /api/analytics/security

Protected endpoints require administrator authentication.

---

# ☁️ Render Deployment

Create a new Render Web Service.

Recommended settings:

Runtime:
Node

Build Command:
npm install

Start Command:
npm start

Add environment variables:

MONGODB_URI
MONGODB_DB
LIVE_PASSWORD
IP_ENCRYPTION_KEY
LIVE_SESSION_SECRET

Do not upload .env to GitHub.

---

# 🗄️ MongoDB Atlas

Create a MongoDB Atlas cluster and database.

Example database:

goatbot

The application automatically creates the required collections and indexes.

---

# ⚠️ Important Architecture

A Messenger bot cannot directly obtain a user's public IP simply because someone sends:

ip

to the bot.

Messenger/Meta does not provide the sender's network IP to the bot.

Correct architecture:

USER
 |
 | Opens Tracker URL
 v
BROWSER
 |
 v
RAKIB TRACKER
 |
 +---------+---------+
 |         |         |
 v         v         v
IP      DEVICE      GEO
 |         |         |
 +---------+---------+
           |
           v
        MongoDB
           |
     +-----+-----+
     |           |
     v           v
Dashboard     Live SSE

The bot should provide the tracker URL instead of directly calling /api/track.

This ensures the tracked request represents the visitor browser rather than the bot's own hosting server.

---

# 🚦 Rate Limiting

The tracker includes request protection and tracking safeguards.

Rate limiting is intended to reduce:

- Accidental request flooding
- Repeated tracking calls
- Excessive API requests
- Basic automated abuse

---

# 🧪 Development

Start:

npm start

Health:

curl http://localhost:3000/health

Statistics:

curl http://localhost:3000/api/stats

Protected endpoints require administrator authentication.

---

# 📦 Production

Start:

npm start

Server:

0.0.0.0:3000

Port configuration:

PORT=3000

---

# 🧹 Git Workflow

Check:

git status

Stage:

git add .

Commit:

git commit -m "upgrade visitor and server analytics"

Push:

git push origin main

---

# 📡 Data Flow

VISITOR
   |
   v
/api/track
   |
   +--------+--------+--------+
   |        |        |        |
   v        v        v        v
  IP      DEVICE    GEO    SESSION
   |        |        |        |
   +--------+--------+--------+
            |
            v
         MONGODB
            |
      +-----+-----+-----+
      |     |     |     |
      v     v     v     v
   PAGE  REQUEST SECURITY LIVE
   VIEW  LOG     LOG      SSE
      |     |     |        |
      +-----+-----+--------+
            |
            v
        DASHBOARD

---

# 🔒 Security Recommendations

## MongoDB Credentials

Never expose your MongoDB connection string publicly.

If MongoDB credentials are exposed:

1. Change the MongoDB user password.
2. Generate a new connection string.
3. Update MONGODB_URI.
4. Update the Render environment variable.
5. Redeploy the application.

## Environment Variables

Keep private credentials inside:

.env

Never place credentials inside:

server.js
public/app.js
public/index.html
README.md

---

# ❤️ Credits

Built with ❤️ by Rakib

RAKIB // DIGITAL INTELLIGENCE SYSTEM

NETWORK • DEVICE • GEO • SESSION
REQUESTS • SECURITY • SERVER • LIVE
MONGODB POWERED

---

# 📜 License

This project is intended for legitimate analytics, development and educational purposes.

Use responsibly and respect:

- Applicable privacy laws
- User expectations
- Platform rules
- Website policies
- Data protection requirements

Do not use the system for unauthorized surveillance, credential collection, covert tracking or other abusive purposes.

---

# 👑 RAKIB IP INTELLIGENCE

RAKIB IP INTELLIGENCE

NETWORK • DEVICE • GEO • SESSION
REQUESTS • SECURITY • SERVER • LIVE

MONGODB POWERED

