# Zang-Pitch-Correction-AI

An offline, standalone vocal editor for auditioning automatic pitch correction, note-level edits and background-vocal timing alignment. Audio is processed on your computer. All tracks start at the same time; export your Pro Tools stems from a common selection.

## Open the beta

1. [Download the Mac beta](../../raw/main/downloads/Zang-Pitch-Correction-AI-Mac-Beta.zip) and unzip it.
2. Open **Zang-Pitch-Correction-AI.html** in Chrome. The file contains the entire editor and works offline. The included **Zang Pitch Correction AI.app** launcher opens the same editor in a dedicated Chrome window. The beta launcher is unsigned. Opening the HTML directly requires no change to your Mac's security settings.
3. Click **Import WAVs** in the center of the editor, or drop your dry lead, harmony and double WAVs there. Each vocal stem should contain a single singer. Click **Import Backing Track** to add the instrumental and analyze its chords. If it is already in the track list, set its role to **Reference** and select it under **Pitch settings → Chord guide**.
4. Check the tracks to edit. Choose a key, scale and pitch strength, then click **Tune checked tracks**. For grid timing, enter the actual tempo and subdivision and use **Correct to grid** or **Tune + correct timing**. The grid begins at the start of the imported files.
5. For BGVs, select the lead under **Guide track**, check the harmonies and click **Align checked BGVs**. The guide is excluded from this operation. Global timing strength and each track's tightness multiply. Pitch targets stay independent of the guide.
6. Right-click in the note editor. Click a primary icon to use it, or hover over it to reveal its subtools vertically. Hover over an icon for its name. Pitch modulation and drift are below Pitch. With Main or Pitch selected, drag the pink dot between connected blobs toward the next note’s pitch for a stronger glide, or back toward the first pitch for a lighter one. Play the phrase to hear the transition. The Main tool adjusts pitch with a vertical drag and timing with a horizontal drag. Drag the right edge to change length. Right-click a note for **Keep original pitch** and **Reset note**.
7. Click a note to hear its vocal audio. While dragging pitch, the recorded vowel sustains and follows the edit continuously. Release to end the audition. **Monitor on/off** switches note auditioning. Hold **Shift–Option–Command** and click to zoom in at the pointer, or drag right to increase time zoom and down to increase pitch zoom. Drag the other way to zoom out. Time zoom reaches 256× and pitch zoom 12×. Shift-scroll moves horizontally through the visible timeline. Playback returns to its manually placed start marker each time you stop. Click the ruler or empty timeline to move it. The Zoom and Drag view tools are also under Main. Use the volume and pan knobs to mix while listening, including during original/edited comparisons. Drag vertically, use the arrow keys for fine adjustment, or double-click to reset. Mixer levels, pan, mute and solo are monitoring settings. Exported stems retain their individual edited levels and original channel formats for mixing in your DAW.
8. **Save project** downloads a self-contained `.zpitch` with the original samples and editable decisions. **Open project** restores it. Save before closing. **Export stems** downloads a ZIP of individual 24-bit WAVs at the input sample rates, lengths and channel counts. **Project → Export active WAV** renders only the active track. All exports contain the edited signal regardless of the audition setting. PCM export clips levels above full scale.

## Tune the lead against the backing track

Import the instrumental and lead from the same timeline start. Check the lead and click **Tune checked tracks**. The chord names above the timeline show what the editor detected. Click a vocal note to hear it and see the supporting chord and suggested pitch. Use **Listen: Original/Edited** to judge it against the instrumental. Drag the pitch to override a suggestion, or click **Keep original pitch**. Both choices protect that note on subsequent chord-guided passes. **Reset note** clears the manual override and the other edits on that note.

The editor looks for sustained changes of pitch within a word and can separate an opening scoop from its landing. The scoop follows the landing’s pitch correction so its shape remains editable. Natural pitches have dark timeline rows and accidentals have lighter rows.

The editor considers the measured vocal pitch, local chord, selected scale and surrounding melodic intervals. A borrowed chord can support a note outside the selected key. A well-centered passing note can stay outside the chord. The pitch pass moves note centers and retains their vibrato and drift settings. When a chord cannot be named, the editor can use the pitch classes audible in the backing during that note. If neither the chord nor its local tones are clear, or the vocal pitch is unreliable, the editor holds that note for review. The pitch pass reports how many notes changed and which backing track it used. Selecting **Key and scale only** returns to the original tuning mode. The guide choice is saved with the project and its chord map is rebuilt from the stored backing audio when reopened.

## Beta scope

The note-boundary classifier was fitted to generated vocal pitch and energy contours. Monophonic pitch estimation, contextual pitch-target selection, time alignment and resynthesis run locally. Chord recognition estimates major, minor and diminished triads. Dense arrangements, extensions, fast changes and isolated bass lines can give an ambiguous or incorrect chord. The singer’s intended melody still needs your ear. Rehearse with a short dry chorus first. Overlapping singers, heavy reverb, fast scoops, breathy voices, long gaps, different lyrics and timing errors over approximately 700 ms are challenging. The guide matcher compares shared syllable timing using audio features. Use a BGV guide for answer phrases.

Pitch drift adjusts slower deviations within a note. Modulation adjusts faster ones. Transition controls blend into an adjacent connected note. Attack and the internal time handle move anchors inside the note. Formant editing is experimental. The beta has no listening benchmark establishing parity with Melodyne or VocAlign and no measured percentage of manual work saved. Automatic passes recompute the affected parameters on checked tracks; apply them before detailed manual work. Undo and redo cover note edits. The original recording stays in the project.

## Build and verify

Open the checked-in HTML to run the editor. There are no runtime package downloads. Python 3 builds the portable file from the source modules. The macOS package uses a small shell launcher and the installed browser.

```sh
python3 tools/build.py --mac
node tests/audio.cjs
```

The Mac ZIP appears in `dist/`. To run the end-to-end UI test, install Playwright and Chromium in a development environment, then run `node tests/ui.cjs`. Set `CHROMIUM_PATH` to use an existing Chromium binary. The synthetic test suite measures the pitch and onset of the actual rendered waveforms. Real vocal quality must be evaluated by listening. The optional training script uses NumPy and scikit-learn to regenerate the included classifier coefficients.
