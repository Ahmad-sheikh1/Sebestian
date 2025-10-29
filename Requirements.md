# Requirements

<aside>

The goal of this project is to design a **fully autonomous system** that can run without any manual input. Once deployed, the workflow should automatically generate, assemble, and publish new Lo-Fi mixtapes to YouTube on a defined schedule. The system must handle all steps end-to-end → from content creation and audio processing to artwork generation, metadata setup, and final upload.

</aside>

# Project Idea

The project idea is to build an automated workflow that creates and uploads lo fi mixtapes to YouTube without manual effort. The workflow runs on n8n and connects different components to handle the process end to end. A daily trigger starts the flow, generates a consistent title and caption using ChatGPT, and creates artwork in the right format for the video and thumbnail. MusicGPT generates a set of tracks that are normalized, crossfaded, and exported as a single audio mix using FFmpeg. This mix is combined with the artwork to produce a video that includes subtle motion to avoid being flagged as static. Metadata such as title, description, tracklist, tags, and chapters are prepared and added. The video, thumbnail, and all metadata are then uploaded through the YouTube Data API. Each run is logged, errors are retried automatically, and notifications are sent if something fails. The project aims to test the flow first and later scale it as a way to promote the MusicGPT app and API by publishing consistent music mixes on YouTube.

Find MusicGPT API Documentation here: [https://docs.musicgpt.com/api-documentation/index/introduction](https://docs.musicgpt.com/api-documentation/index/introduction)

# Initial Prompt

<aside>

You generate structured metadata for a Lo Fi music mixtape video.
Create one cohesive concept where a short VIBE term leads everything.

Goals

1. Invent a compact VIBE name that feels like Lo Fi mood words such as Ocean Breeze, Night City Reflections, Morning Haze, Rainy Days, Sunset Dawn, Cozy Study Room, Midnight Drive, Forest Cabin, Snowy Window, etc.
2. Avoid em dashes. Use normal punctuation only. Hyphens are allowed but keep them minimal.
3. The main_title must include the VIBE at the start. The subtitle stays standardized.
4. The scene_description is a one-line visual for the artwork that matches the VIBE.
5. The caption is a short YouTube-style paragraph that uses main_title, subtitle, and scene_description and invites to relax, study, or focus.
6. Produce a stable image_prompt for a stylized cozy illustration suited for 1920x1080. Prefer deep blues, purples, warm lamp light, clean framing, desktop or window scenes, soft grain, subtle glow, no text in the image.
7. Generate clean comma-separated tags. Max 12 items. No hashtags.
8. Respect uniqueness. Do not repeat any item from recent_vibes exactly.
9. Create an array called "song_prompts" with exactly 10 detailed prompts for individual Lo-Fi instrumental tracks. Each prompt must:
    - Clearly state that it is a *lo fi instrumental* in the first sentence.
    - Match the same vibe and overall mood as the mixtape.
    - Focus on cozy, calm, and deeply relaxing textures rather than jazzy or energetic sounds.
    - Include references to core lo-fi instrumentation and texture, such as: soft drums, vinyl crackle, warm electric piano (Rhodes), muted or plucked guitar, ambient synth pads, organic percussive elements, light bass tones, and environmental background sounds (rain, wind, rustle, city ambience).
    - Specify tempo range (70–90 BPM) and rhythmic feel (swing or straight pocket).
    - Describe arrangement or atmosphere (intro length, loop, subtle fills, outro) and mix character (warm, tape-saturated, low-passed, balanced for study focus).
    - Slightly differ from others in rhythm, focus, or emotional nuance (e.g., late-night reflection, cozy morning calm, nostalgic haze, rainy focus, mellow sunrise).
    - Stay cohesive enough to belong to the same mixtape.
    - Be written naturally in English, around two to three sentences each (45–70 words).
    - Always sound clearly and authentically lo-fi — never electronic, EDM, cinematic, or jazzy. Avoid trumpets, saxophones, upright bass, brass instruments, or swing-band sounds.

Inputs
preferred_vibe: {{preferred_vibe}}
recent_vibes: {{recent_vibes}}  // array of strings can be empty

Field rules
subtitle must always be "Lo Fi Focus Mix".
thumbnail_text must place the VIBE on top line and the subtitle on second line.
video_title format: "{main_title}" where main_title = "{VIBE} " + subtitle.
No emojis. No em dashes.

Output only valid JSON with these fields:
{
"vibe": "string",
"main_title": "string",
"subtitle": "Lo Fi Focus Mix",
"scene_description": "string",
"caption": "string",
"tags": ["string", "..."],
"thumbnail_text": "string",
"image_prompt": "string",
"video_title": "string",
"song_prompts": ["string", "..."]
}

</aside>

# Flow Idea

### **Step 1 Trigger**

> A daily cron trigger starts the workflow. It simply initializes execution.
> 

---

### **Step 2 Title and Caption**

> The initial prompt is executed through the OpenAI API. This generates the full metadata JSON including:
*vibe, 
main_title, 
subtitle (“Lo Fi Focus Mix”), 
scene_description, 
caption, 
tags, 
thumbnail_text, 
image_prompt, 
video_title, 
array of 10 song_prompts (each returning 2 songs).*
These outputs are stored for all following workflow steps.
> 

---

### **Step 3 Artwork**

> The artwork is generated from the image_prompt using OpenAI Image API (landscape ratio). 
The image is later upscaled to 1920×1080 via FFmpeg.
A thumbnail version is generated with text overlay (VIBE + subtitle) using FFmpeg.
The video background version remains text-free.
> 

---

### **Step 4 Audio Creation**

> Twenty tracks are generated from the MusicGPT API according to the Lo-Fi channel rules.
> 
- Each track is downloaded or stored, and its duration is captured.
- File format and structure follow the API’s output standards (e.g., MP3 or WAV).

---

### **Step 5 Mixdown**

> Each track is normalized to a target loudness, then combined into one continuous mix using crossfades of about eight seconds
> 
- FFmpeg handles normalization, crossfading, and exporting of the final mix
- The master output is saved as a single audio file
- Chapter timestamps are calculated and a tracklist string is generated automatically

---

### **Step 6 Video Composition**

> The artwork and final audio mix are merged into a video
> 
- A subtle zoom effect is applied so YouTube does not treat the frame as static
- The final output is a ready-to-upload MP4 video

---

### **Step 7 Metadata**

> Metadata is finalized based on the generated JSON
> 
- The title and description are created from main_title, subtitle, and caption
- The tracklist and footer are inserted into the description
- Tags are cleaned and formatted to meet YouTube requirements

---

### **Step 8 Upload**

> The video, metadata, and thumbnail are uploaded through the YouTube Data API
> 
- Title, description, tags, category, privacy setting, and schedule are applied
- The thumbnail is uploaded automatically
- Chapters are added to the description

---

### **Step 9 Logging and Notifications**

> Every workflow run is logged with inputs, outputs, video ID, and durations
> 
- Failed steps trigger automatic retries
- Alerts are sent via Slack or email if something goes wrong
- Logs are stored for later review and performance tracking

---

### **Step 10 Check Final Video**

> The workflow verifies that the uploaded video is visible and correctly published on YouTube
> 

---

### **Tools**

- **MusicGPT API** — generates the individual Lo-Fi tracks and is the product being promoted
- **FFmpeg** — handles normalization, crossfading, mastering, text overlay, and video composition
- **n8n** — orchestrates the full workflow including API calls, file handling, and automation
- **ChatGPT** — generates structured metadata, titles, captions, and artwork prompts

# **Deliverables**

- Fully working n8n workflow implementing all steps from trigger to YouTube upload
- Documentation describing configuration and API connection
- Example configuration for one Lo-Fi channel
- Short handover call and explanation of the architecture