# Labtechshow Studio - Live Stream Overlay & Hub Control

Welcome to **Labtechshow Studio**, a premium stream controller and live graphic overlay engine designed specifically for the **Labtechshow** (hosted by Corey Tallboy Sanders).

This system is built with a **zero-dependency, serverless local architecture** allowing you to run your broadcast assets completely offline or integrate them directly as high-performance Browser Sources in **vMix** streaming software.

---

## 🚀 Getting Started

1. Navigate to the `lab-tech-studio` folder.
2. Open [dashboard.html](file:///C:/Users/tallb/.gemini/antigravity-ide/scratch/lab-tech-studio/dashboard.html) in your web browser (Chrome, Brave, or Edge recommended).
3. Open the chromeless rendering target by clicking the **"Launch Live Overlay Window"** button inside the dashboard, or directly open [overlay.html](file:///C:/Users/tallb/.gemini/antigravity-ide/scratch/lab-tech-studio/overlay.html).
4. Place the two windows side-by-side. Make edits in the dashboard, and notice how the live overlay window updates **instantly, without page reload!**

---

## 🎥 Integration with vMix

To overlay these graphics on top of your live video feeds in vMix:

1. Open **vMix**.
2. Click on the **"Add Input"** button in the bottom-left corner of the window.
3. In the input selector dialog, click on the **"Web Browser"** tab on the left sidebar.
4. Set the URL text field to the local file path of the overlay file:
   ```
   file:///C:/Users/tallb/.gemini/antigravity-ide/scratch/lab-tech-studio/overlay.html
   ```
5. Set the Resolution width to **1920** and height to **1080**.
6. Check the **"Transparent"** option (if present; vMix handles HTML transparency automatically).
7. Click **OK**.
8. Click one of the **Overlay Channel buttons (1, 2, 3, or 4)** below the new Web Browser input to overlay the graphics canvas on top of your live stream feed! All animations and real-time updates from the dashboard will render live instantly.

---

## 📋 Run of Show (Rundown Hub) Flow

The Rundown Hub mimics professional TV production switchboards:
1. Select the **Rundown Hub** tab in the dashboard header.
2. Build your segments (Intro, Hot Takes, Guest Interviews, Sponsor reads).
3. Under each segment, you can enter segment-specific guest names, social handles, custom scrolling marquee items, and sponsor banners.
4. Click the **"AIR SEGMENT"** button. The status bar immediately transitions to **"ON AIR: ACTIVE SEGMENT"** and pushes all segment details to the overlay. The lower thirds, ticker content, and sponsor CTA adjust in real time!
5. Toggle it off to reset the overlays back to the default state.

---

## 💎 Phased SaaS Agency Roadmap

The codebase has been designed from day one with the structural patterns needed to transition to a commercial multi-tenant SaaS application:

### Phase 1: Custom Client Spaces (Agency Model)
- **Current State**: The system includes a simulated **Workspace / Agency Tenant** selector at the top-right. You can swap between "Labtechshow", "The Business of Technology", and "Tallboy Media".
- **Database Architecture (`app.js`)**: All configurations are grouped under show preset objects with unique IDs, custom typography, brand color vectors, and standalone rundown segments.
- **SaaS Conversion**: By swapping the client-side `localStorage` array inside `app.js` with a relational database client (e.g. Supabase, Firebase, or Postgres), user accounts can load their specific workspace presets from the server.

### Phase 2: Producer / Talent Collaboration
- **Current State**: The system supports **Role Switcher** options.
  - **Admin / Creator**: Full design controls (color pickers, font adjusters, layout margins).
  - **Producer**: Clean access limited to the Rundown Hub and segment AIR toggles.
- **SaaS Integration**: Using WebSockets (or Supabase Realtime Channels), the Producer can click "AIR" on a laptop while the Admin runs the streaming system on a completely separate machine. The overlay updates instantly across the internet without any local configuration!
