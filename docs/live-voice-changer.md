# Live voice changer

**Tools → Live voice changer** changes your voice in real time while you talk.
It works the same on Windows, macOS and Linux, needs no model download or GPU,
and runs entirely on your computer — no audio leaves it.

## Quick start

1. Put on **headphones**. With speakers, the microphone hears the changed voice
   and it can loop into loud feedback.
2. Open **Tools → Live voice changer** and press **Start**. Allow microphone
   access if your system asks.
3. Pick a preset (Deep, Chipmunk, Robot, Radio, Cave …) or move the sliders:

| Control | What it does |
|---|---|
| Pitch | Lower or raise your voice by up to 12 semitones (one octave). |
| Tone | Darker (left) or brighter (right). |
| Robot | Metallic ring-modulated robot voice. |
| Echo | Room/cave echo. |
| Volume | Output level. A built-in limiter stops sudden loud bursts. |
| Radio filter | Narrow walkie-talkie sound. |

Changes apply instantly. The voice changer keeps running while you use other
pages of the app; press **Stop** to release the microphone. It adds roughly
50–100 ms of delay, mostly from your audio hardware.

## Use it in Discord, Zoom, OBS or games

Other apps can't hear VoiceStudio's output directly, so route it through a
**virtual audio cable** — a fake speaker whose sound comes out of a fake
microphone:

1. Install a virtual cable for your system (one-time):
   - **Windows:** [VB-CABLE](https://vb-audio.com/Cable/) (free). Restart after installing.
   - **macOS:** [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole) (free).
   - **Linux (PipeWire or PulseAudio):** create a virtual sink — it disappears
     on reboot, so add the command to your startup apps if you use it often:

     ```bash
     pactl load-module module-null-sink sink_name=VoiceChanger sink_properties=device.description=VoiceChanger
     ```

2. In **Live voice changer**, set **Output device** to the cable
   (*CABLE Input* on Windows, *BlackHole 2ch* on macOS, *VoiceChanger* on Linux).
3. In Discord (**User Settings → Voice & Video → Input Device**), Zoom, OBS or
   your game, choose the cable's microphone side
   (*CABLE Output* on Windows, *BlackHole 2ch* on macOS, *Monitor of VoiceChanger* on Linux).
4. Turn off Discord's **Noise Suppression (Krisp)** if robot or radio effects
   get cut out — it treats them as noise.

When the output goes to the cable you no longer hear yourself. That's expected:
use the other app's mic test (Discord: **Let's Check**) to listen.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Microphone access was denied" | Allow VoiceStudio under *Privacy & Security → Microphone* (macOS) or *Settings → Privacy → Microphone* (Windows), then press Start again. |
| Loud howling | You're using speakers. Use headphones, or lower Volume. |
| Other app hears nothing | Check that Output device is the cable and the other app's input is the cable's microphone side, and that the voice changer shows **Live**. |
| Output device list is empty or missing the cable | Press Start once (device names appear after mic access is granted). Restart VoiceStudio after installing a cable. |
| Slight warble on big pitch changes | Normal for real-time shifting; smaller steps (±3–6 semitones) sound most natural. |

This is an effects-based voice changer. To make a recording sound like a
specific saved voice, use **Tools → Convert** instead.
