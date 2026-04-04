# build-resources

Place your app icons here before building:

| File         | Size     | Used for                |
|--------------|----------|-------------------------|
| `icon.ico`   | 256x256  | Windows installer + taskbar |
| `icon.icns`  | 512x512  | macOS DMG + dock        |
| `icon.png`   | 512x512  | Fallback / Linux        |

You can generate these from a single 1024x1024 PNG using:
- https://www.icoconverter.com (ICO)
- https://cloudconvert.com/png-to-icns (ICNS)

Or use the `electron-icon-builder` npm package:
```
npx electron-icon-builder --input=icon-source.png --output=build-resources
```
