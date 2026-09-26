# Privacy-Safe IP Tracker

A small Express application that displays:

- Visitor IP
- Approximate IP-based country/region/city
- ISP / organization
- ASN
- Timezone
- Browser
- Operating system
- Device type/model when the User-Agent provides it

## Important

IP geolocation is approximate. It does not provide GPS or an exact street address.

The app does not store visitor records, cookies, localStorage data, or a persistent fingerprint.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

API:

```text
GET /api/track
```

Health:

```text
GET /health
```

## Render

Push the project to GitHub and create a Render Web Service.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

The included `render.yaml` can also be used with Render Blueprint deployment.

## Geolocation provider

The demo uses ipwho.is for approximate IP geolocation. For production traffic, review that provider's current API terms/rate limits and consider using your own licensed geolocation database/service.
