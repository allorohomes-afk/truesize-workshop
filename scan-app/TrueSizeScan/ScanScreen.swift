// The scanning screen: Apple's RoomCaptureView with Cancel / Done, then "Use this scan" once RoomPlan has built
// the room.
import RoomPlan
import SwiftUI

final class CaptureController: NSObject, ObservableObject, RoomCaptureViewDelegate {
    let view = RoomCaptureView(frame: .zero)
    @Published var result: CapturedRoom?
    @Published var finishing = false
    @Published var problem: String?

    override init() {
        super.init()
        view.delegate = self
    }

    // RoomCaptureViewDelegate inherits NSCoding; we never archive this object.
    required init?(coder: NSCoder) { nil }
    func encode(with coder: NSCoder) {}

    func start() { view.captureSession.run(configuration: RoomCaptureSession.Configuration()) }
    func finish() { finishing = true; view.captureSession.stop() }
    func cancel() { view.captureSession.stop() }

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool { true }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        DispatchQueue.main.async {
            self.finishing = false
            if let error { self.problem = error.localizedDescription }
            self.result = processedResult
        }
    }
}

struct RoomCaptureRepresentable: UIViewRepresentable {
    let controller: CaptureController
    func makeUIView(context: Context) -> RoomCaptureView { controller.view }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}

struct ScanScreen: View {
    @StateObject private var capture = CaptureController()
    let onDone: (CapturedRoom?) -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            RoomCaptureRepresentable(controller: capture).ignoresSafeArea()
            VStack(spacing: 8) {
                if let problem = capture.problem { Text(problem).font(.footnote).foregroundStyle(.red) }
                HStack {
                    Button("Cancel") { capture.cancel(); onDone(nil) }
                    Spacer()
                    if capture.result != nil {
                        Button("Use this scan") { onDone(capture.result) }.buttonStyle(.borderedProminent)
                    } else {
                        Button(capture.finishing ? "Building the room…" : "Done scanning") { capture.finish() }
                            .buttonStyle(.borderedProminent)
                            .disabled(capture.finishing)
                    }
                }
            }
            .padding()
            .background(.ultraThinMaterial)
        }
        .onAppear { capture.start() }
    }
}
