# silverbullet-media-slider

A [SilverBullet](https://silverbullet.md) plug that renders an interactive media
slider / carousel inside fenced `media-slider` code blocks. Inspired by the
Obsidian [Media Slider](https://github.com/amatya-aditya/obsidian-media-slider)
plugin.

## Features

- Images, video, audio, PDF, and markdown-file slides
- Thumbnails (top / bottom / left / right)
- Captions (overlay or below)
- Transition effects (fade, slide, zoom, flip, rotate, blur, squeeze, ...)
- Autoplay / slideshow with configurable speed
- Keyboard, mouse-wheel, and touch navigation
- Zoom & pan on images
- Folder expansion (link all media in a folder)
- Fullscreen + copy-markdown-link buttons

## Usage

In any page:

~~~
```media-slider
---
carouselShowThumbnails: true
thumbnailPosition: bottom
transitionEffect: fade
transitionDuration: 300
autoplay: false
slideshowSpeed: 0
width: 100%
height: 380px
enhancedView: true
---
![[photo1.jpg|A sunrise]]
![[photo2.png|A calm lake]]
![[clip.mp4]]
![[song.mp3]]
![[doc.pdf]]
```
~~~

### Linking media

- `![[path/to/file.png]]` — wikilink (path resolved against your space)
- `![[file.png|Caption text]]` — with a caption
- `![alt](path/or/url)` — markdown-image syntax
- Bare URLs (`https://...`) — resolved by Content-Type; YouTube URLs become embeds

### Folder expansion

~~~
```media-slider
---
fileTypes:
  - jpg
  - png
  - mp4
recursive: true
---
[[folder/subfolder/]]
```
~~~

### Markdown slides

A `.md` page referenced in the slider is rendered inline as a slide (read-only).

## YAML options

| option                  | type    | default   | notes                                              |
|-------------------------|---------|-----------|----------------------------------------------------|
| `sliderId`              | string  | auto      | Stable id (use if you want deterministic ids)      |
| `carouselShowThumbnails`| bool    | `true`    | Show the thumbnail strip                          |
| `thumbnailPosition`     | string  | `bottom`  | `top` / `bottom` / `left` / `right`               |
| `captionMode`           | string  | `overlay` | `overlay` or `below`                              |
| `autoplay`              | bool    | `false`   | Autoplay videos                                    |
| `slideshowSpeed`        | number  | `0`       | Seconds between slides; `0` disables autoplay     |
| `width`                 | string  | `100%`    | CSS width                                          |
| `height`                | string  | `380px`   | CSS height                                         |
| `transitionEffect`      | string  | `fade`    | see below                                          |
| `transitionDuration`    | number  | `300`     | milliseconds                                       |
| `enhancedView`          | bool    | `true`    | Show fullscreen + copy buttons; enable zoom/pan    |
| `fileTypes`             | list    | all media | Extensions to include for folder expansion         |
| `recursive`             | bool    | `false`   | Recurse into subfolders during folder expansion    |
| `showThumbnailToggle`   | bool    | `true`    | Show the collapse/expand button on the thumbnail strip |
| `thumbnailsCollapsedByDefault` | bool | `false` | Start with the thumbnail strip collapsed         |

Transition effects: `fade`, `slide`, `zoom`, `slide-up`, `slide-down`,
`flip`, `flip-vertical`, `rotate`, `blur`, `squeeze`.

## Install

Use the `Library: Install` command in SilverBullet with the URL to this repo's
`PLUG.md`:

```
https://github.com/glechic/silverbullet-media-slider/blob/main/PLUG.md
```

(Adjust the URL to wherever you publish it.)

## Build

```shell
npm install
npm run build
```

This produces `media-slider.plug.js` via `plug-compile`.

## License

MIT