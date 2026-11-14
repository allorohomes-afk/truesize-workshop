// Turns a RoomPlan result into the Workshop's scan format: one item per wall, door, window, opening and piece of
// furniture, with its true size (metres), centre and heading. The Workshop squares the room up and builds it.
import Foundation
import RoomPlan
import simd

struct ScanItem: Codable {
    let type: String          // wall, door, window, opening, object
    let category: String?     // for objects: table, sofa, storage, chair…
    let w: Float, h: Float, d: Float
    let x: Float, y: Float, z: Float   // centre, metres
    let yaw: Float                     // heading around the vertical axis, radians
}

struct ScanUpload: Codable {
    let name: String
    let device: String
    let created: String
    let items: [ScanItem]
}

enum ScanExport {
    static func items(from room: CapturedRoom) -> [ScanItem] {
        var out: [ScanItem] = []
        func add(_ type: String, _ category: String?, _ dims: simd_float3, _ t: simd_float4x4) {
            let side = t.columns.0, centre = t.columns.3
            out.append(ScanItem(type: type, category: category, w: dims.x, h: dims.y, d: dims.z,
                                x: centre.x, y: centre.y, z: centre.z, yaw: atan2(-side.z, side.x)))
        }
        for s in room.walls { add("wall", nil, s.dimensions, s.transform) }
        for s in room.doors { add("door", nil, s.dimensions, s.transform) }
        for s in room.windows { add("window", nil, s.dimensions, s.transform) }
        for s in room.openings { add("opening", nil, s.dimensions, s.transform) }
        for o in room.objects { add("object", String(describing: o.category), o.dimensions, o.transform) }
        return out
    }

    /// Size of the room from its walls' end points, in metres (width, depth, height).
    static func size(of room: CapturedRoom) -> (Float, Float, Float) {
        var xs: [Float] = [], zs: [Float] = []
        for s in room.walls {
            let side = s.transform.columns.0, c = s.transform.columns.3
            for k: Float in [-1, 1] {
                xs.append(c.x + k * side.x * s.dimensions.x / 2)
                zs.append(c.z + k * side.z * s.dimensions.x / 2)
            }
        }
        let h = room.walls.map { $0.dimensions.y }.max() ?? 0
        guard let x0 = xs.min(), let x1 = xs.max(), let z0 = zs.min(), let z1 = zs.max() else { return (0, 0, h) }
        return (x1 - x0, z1 - z0, h)
    }

    static func feet(_ metres: Float) -> String {
        let inches = (metres / 0.0254).rounded()
        return "\(Int(inches) / 12)′ \(Int(inches) % 12)″"
    }
}
