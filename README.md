# Zang-Pitch-Correction-AI

An offline, standalone vocal editor for auditioning automatic pitch correction, note-level edits and background-vocal timing alignment. Audio is processed on your computer. All tracks start at the same time; export your Pro Tools stems from a common selection.

## Open the beta

1. [Download the Mac beta](../../raw/main/downloads/Zang-Pitch-Correction-AI-Mac-Beta.zip) and unzip it.
2. Open **Zang-Pitch-Correction-AI.html** in Chrome. The file contains the entire editor and works offline. The included **Zang Pitch Correction AI.app** launcher opens the same editor in a dedicated Chrome window. The beta launcher is unsigned. Opening the HTML directly requires no change to your Mac's security settings.
3. Click **Load demo stack**, or drag in dry lead, harmony and double WAVs. Each vocal stem should contain a single singer. Set an instrumental mix to **Reference** in the track list.
4. Check the tracks to edit. Choose a key, scale and pitch strength, then click **Tune checked tracks**. For grid timing, enter the actual tempo and subdivision and use **Correct to grid** or **Tune + correct timing**. The grid begins at the start of the imported files.
5. For BGVs, select the lead under **Guide track**, check the harmonies and click **Align checked BGVs**. The guide is excluded from this operation. Global timing strength and each track's tightness multiply. Pitch targets stay independent of the guide.
6. Switch between **Stacked lanes** and **Pitch overlay**. Click a note to inspect it. Drag vertically with pitch, drift, modulation, transition, formant, gain, sibilance, attack or internal time-handle tools. Drag horizontally for position, length and fades. You can also type exact values in the inspector. A split needs at least 25 ms on either side of the cursor. Merge combines the selected note with the following one.
7. Press Space to play, click the ruler to seek and use **Listen: Original/Edited** to compare. The track checkboxes control batch processing. Mute and solo control monitoring. The eye controls visibility.
8. **Save project** downloads a self-contained `.zpitch` with the original samples and editable decisions. **Open project** restores it. Save before closing. **Export stems** downloads a ZIP of individual 24-bit WAVs at the input sample rates, lengths and channel counts. **Export active WAV** renders only the active track. All exports contain the edited signal regardless of the audition setting. PCM export clips levels above full scale.

## Beta scope

The note-boundary classifier was fitted to generated vocal pitch and energy contours. Monophonic pitch estimation, contextual pitch-target selection, time alignment and resynthesis run locally. The model does not infer lyrics or intended harmony from a full mix. Rehearse with a short dry chorus first. Overlapping singers, heavy reverb, fast scoops, breathy voices, long gaps, different lyrics and timing errors over approximately 700 ms are challenging. The guide matcher compares shared syllable timing using audio features. Use a BGV guide for answer phrases.

Pitch drift adjusts slower deviations within a note. Modulation adjusts faster ones. Transition controls blend into an adjacent connected note. Attack and the internal time handle move anchors inside the note. Formant editing is experimental. The beta has no listening benchmark establishing parity with Melodyne or VocAlign and no measured percentage of manual work saved. Automatic passes recompute the affected parameters on checked tracks; apply them before detailed manual work. Undo and redo cover note edits. The original recording stays in the project.

## Build and verify

Open the checked-in HTML to run the editor. There are no runtime package downloads. Python 3 builds the portable file from the source modules. The macOS package uses a small shell launcher and the installed browser.

```sh
python3 tools/build.py --mac
node tests/audio.cjs
```

The Mac ZIP appears in `dist/`. To run the end-to-end UI test, install Playwright and Chromium in a development environment, then run `node tests/ui.cjs`. Set `CHROMIUM_PATH` to use an existing Chromium binary. The synthetic test suite measures the pitch and onset of the actual rendered waveforms. Real vocal quality must be evaluated by listening. The optional training script uses NumPy and scikit-learn to regenerate the included classifier coefficients.
