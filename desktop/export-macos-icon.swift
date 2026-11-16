import AppKit

// Run from any directory with: swift desktop/export-macos-icon.swift
// macOS app tiles occupy 824 px of a 1024 px canvas; keep the web artwork intact.
let icons = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("src-tauri/icons")
let artwork = NSImage(contentsOf: icons.appendingPathComponent("icon-api-ai-v1.png"))!
let source = artwork.cgImage(forProposedRect: nil, context: nil, hints: nil)!
let files = FileManager.default
let temporary = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
let iconset = temporary.appendingPathComponent("AppIcon.iconset")
try files.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? files.removeItem(at: temporary) }

func render(_ size: Int) throws -> Data {
    let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    let scale = CGFloat(size) / 1024
    let tile = CGRect(x: 100 * scale, y: 100 * scale, width: 824 * scale, height: 824 * scale)
    context.addPath(CGPath(roundedRect: tile, cornerWidth: 184 * scale,
                           cornerHeight: 184 * scale, transform: nil))
    context.clip()
    context.interpolationQuality = .high
    context.draw(source, in: tile)
    return NSBitmapImageRep(cgImage: context.makeImage()!)
        .representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try render(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try render(1024).write(to: icons.appendingPathComponent("macos-icon.png"))
let export = Process()
export.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
export.arguments = ["--convert", "icns", "--output",
                    icons.appendingPathComponent("icon.icns").path, iconset.path]
try export.run()
export.waitUntilExit()
guard export.terminationStatus == 0 else { fatalError("macOS icon export failed") }
print("Exported macOS icon with 100 px transparent margins on a 1024 px canvas")
