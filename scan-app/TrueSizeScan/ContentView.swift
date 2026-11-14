// Home screen: name the room, scan it, check the size, send it to the Workshop.
import RoomPlan
import SwiftUI

struct ContentView: View {
    @AppStorage("workshopURL") private var workshopURL = ""
    @AppStorage("space") private var space = ""
    @State private var spaces: [(id: String, label: String)] = []
    @State private var roomName = ""
    @State private var scanning = false
    @State private var room: CapturedRoom?
    @State private var modelFile: URL?
    @State private var status = ""
    @State private var sending = false

    var body: some View {
        NavigationStack {
            Form {
                if !RoomCaptureSession.isSupported {
                    Section {
                        Text("This device has no LiDAR scanner. TrueSize Scan needs an iPhone Pro or an iPad Pro.")
                            .foregroundStyle(.red)
                    }
                }
                Section("Room") {
                    TextField("Room name (e.g. Grand Ballroom)", text: $roomName)
                    Button { scanning = true } label: { Label("Scan a room", systemImage: "viewfinder") }
                        .disabled(!RoomCaptureSession.isSupported)
                }
                if let room {
                    Section("Your scan") {
                        Text(summary(room))
                        Button { Task { await send(room) } } label: {
                            Label(sending ? "Sending…" : "Send to Workshop", systemImage: "paperplane")
                        }
                        .disabled(sending)
                        if let modelFile {
                            ShareLink(item: modelFile) { Label("Save the 3D model (USDZ)", systemImage: "square.and.arrow.up") }
                        }
                    }
                }
                if !status.isEmpty { Section { Text(status) } }
                Section("Workshop") {
                    TextField("Workshop address (https://…)", text: $workshopURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { Task { await loadSpaces() } }
                    if spaces.isEmpty {
                        Text("Enter the address, then the workspaces appear here.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Picker("Workspace", selection: $space) {
                            ForEach(spaces, id: \.id) { Text($0.label).tag($0.id) }
                        }
                    }
                }
                Section {
                    Text("Tips: turn on the lights, walk slowly, point at every wall and corner, and open the doors. Your phone must be on the same private network or VPN as the Workshop.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("TrueSize Scan")
            .task { await loadSpaces() }
            .fullScreenCover(isPresented: $scanning) {
                ScanScreen { result in
                    scanning = false
                    guard let result else { return }
                    room = result
                    status = ""
                    modelFile = exportModel(result)
                }
            }
        }
    }

    private func summary(_ room: CapturedRoom) -> String {
        let (w, d, h) = ScanExport.size(of: room)
        return "\(ScanExport.feet(max(w, d))) × \(ScanExport.feet(min(w, d))), \(ScanExport.feet(h)) tall\n"
            + [count(room.walls.count, "wall"), count(room.doors.count, "door"), count(room.windows.count, "window"),
               count(room.objects.count, "piece of furniture", "pieces of furniture")].joined(separator: " · ")
    }

    private func count(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : many ?? one + "s")"
    }

    private func exportModel(_ room: CapturedRoom) -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName).usdz")
        try? FileManager.default.removeItem(at: url)
        return (try? room.export(to: url)) != nil ? url : nil
    }

    private var safeName: String {
        let n = roomName.trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "Room scan" : n
    }

    /// Ask the Workshop which workspaces it has (GET /api/config).
    private func loadSpaces() async {
        guard let url = URL(string: "\(workshopURL.trimmingCharacters(in: .whitespaces))/api/config"), url.host != nil else { return }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let cfg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let list = cfg["spaces"] as? [[String: String]] else { return }
        spaces = list.compactMap { s in s["id"].map { ($0, s["label"] ?? $0) } }
        if !spaces.contains(where: { $0.id == space }) { space = spaces.first?.id ?? "" }
    }

    private func send(_ room: CapturedRoom) async {
        sending = true
        defer { sending = false }
        let upload = ScanUpload(name: safeName, device: UIDevice.current.model,
                                created: ISO8601DateFormatter().string(from: Date()),
                                items: ScanExport.items(from: room))
        guard !space.isEmpty, let url = URL(string: "\(workshopURL.trimmingCharacters(in: .whitespaces))/api/scans?space=\(space)") else {
            status = "Add the Workshop address and pick a workspace first (under Workshop, below)."
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(upload)
        req.timeoutInterval = 30
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if (resp as? HTTPURLResponse)?.statusCode == 200, let saved = reply?["saved"] as? String {
                status = "Sent as \"\(saved)\". In the Workshop, tap Import scan."
            } else {
                status = "The Workshop said: \(reply?["error"] as? String ?? "something went wrong")."
            }
        } catch {
            status = "Couldn't reach the Workshop. Are you on the same network or VPN? (\(error.localizedDescription))"
        }
    }
}
