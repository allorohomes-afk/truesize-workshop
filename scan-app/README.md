# TrueSize Scan

Free room scanner for the TrueSize Workshop. Uses Apple RoomPlan (the LiDAR scanner on iPhone Pro / iPad Pro) to measure
every wall, door, window and piece of furniture, then sends them to your TrueSize Workshop. No account, no subscription, nothing leaves your
own network.

## Put it on an iPad or iPhone (once)
1. Open `TrueSizeScan.xcodeproj` in Xcode.
2. Xcode → Settings → Accounts → add your Apple ID (the developer account).
3. Click the **TrueSizeScan** project → **Signing & Capabilities** → Team: pick your team.
4. Plug in the iPad with a cable, unlock it, tap **Trust**. Pick it at the top of Xcode, press **▶ Run**.
5. First time only, on the iPad: Settings → Privacy & Security → **Developer Mode** on (it restarts), and
   Settings → General → VPN & Device Management → trust the developer.

With the paid developer account the app keeps working for a year; with a free Apple ID it must be re-run every 7 days.

## Use it
Name the room → **Scan a room** → walk slowly around, pointing at every wall → **Done scanning** → **Use this scan** →
**Send to Workshop**. In the Workshop (same workspace), tap **📐 Import scan** and pick the room.

First time: under **Workshop**, type the Workshop's address (the address you open it at) and pick a workspace.
