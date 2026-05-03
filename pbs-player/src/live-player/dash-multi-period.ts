import { loadState } from '../lib/local-storage';
import { CAPTIONS_SELECTION_KEY } from '../captions/store';
import { safePlay } from '../shared/safe-play';
import { PBSPlayerLivestream } from './videojs';

/**
 * Multi-Period DASH support for MediaTailor SSAI livestreams.
 *
 * When MediaTailor inserts a preroll ad, the MPD contains multiple periods
 * (ad period → content period). This module handles:
 *  - dash.js settings for gap bridging at period boundaries
 *  - Bridging TTML text tracks from dash.js into videojs for the captions menu
 *  - Syncing user caption preferences with dash.js on period transitions
 *  - Seeking to the live edge and resuming playback after period switches
 *
 * This entire module can be removed when DASH support is dropped.
 */

/**
 * Bridge dash.js TTML text tracks into videojs so they appear in the captions menu.
 * With useTTML: true, dash.js renders captions itself but doesn't create videojs
 * TextTrack objects, so the ManifestCaptionsButton has nothing to display.
 */
function bridgeDashTextTracks(player: PBSPlayerLivestream): void {
  const dashTextTracks = player.dash.mediaPlayer.getTracksFor('text');
  if (!dashTextTracks || dashTextTracks.length === 0) return;

  // Avoid duplicates — only add tracks that don't already exist in videojs
  const existingTracks = player.textTracks();
  const existingLangs = new Set<string>();
  for (let i = 0; i < existingTracks.length; i++) {
    if (existingTracks[i].kind === 'captions' || existingTracks[i].kind === 'subtitles') {
      existingLangs.add(existingTracks[i].language);
    }
  }

  dashTextTracks.forEach((dashTrack) => {
    if (existingLangs.has(dashTrack.lang)) return;
    player.addRemoteTextTrack({
      kind: 'captions',
      language: dashTrack.lang,
      label: dashTrack.labels?.length > 0 ? dashTrack.labels[0].text : dashTrack.lang,
      default: false,
    }, false);
  });
}

/**
 * Sync dash.js text visibility with the user's saved caption preference.
 * dash.js re-enables TTML on every period transition, so we must explicitly
 * disable it if the user had captions off.
 */
function syncDashTextWithSavedPreference(player: PBSPlayerLivestream): void {
  const savedLabel: string = loadState(CAPTIONS_SELECTION_KEY);
  const shouldShow = savedLabel && savedLabel !== 'Off';
  player.dash.mediaPlayer.enableText(!!shouldShow);
}

/**
 * Wire up the videojs text track change event to sync selections back to dash.js,
 * so toggling captions in the menu shows/hides the TTML overlay.
 */
function syncVideojsTrackChangesToDash(player: PBSPlayerLivestream): void {
  //@ts-ignore
  player.textTracks().on('change', () => {
    const vjsTracks = player.textTracks();
    let anyShowing = false;
    for (let i = 0; i < vjsTracks.length; i++) {
      if ((vjsTracks[i].kind === 'captions' || vjsTracks[i].kind === 'subtitles') && vjsTracks[i].mode === 'showing') {
        anyShowing = true;
        // Find the matching dash.js track index and select it
        const dashTextTracks = player.dash.mediaPlayer.getTracksFor('text');
        for (let j = 0; j < dashTextTracks.length; j++) {
          if (dashTextTracks[j].lang === vjsTracks[i].language) {
            player.dash.mediaPlayer.setTextTrack(j);
            break;
          }
        }
        break;
      }
    }
    player.dash.mediaPlayer.enableText(anyShowing);
  });
}

/**
 * Initialize multi-period DASH support on a live player instance.
 * Call this after the player is mounted and player.dash.mediaPlayer is available.
 */
export function initDashMultiPeriod(player: PBSPlayerLivestream): void {
  if (!player.dash?.mediaPlayer) return;

  // Configure dash.js for multi-period gap bridging and DRM robustness
  player.dash.mediaPlayer.updateSettings({
    streaming: {
      gaps: {
        jumpGaps: true,
        jumpLargeGaps: true,
        smallGapLimit: 1.5,
      },
      protection: {
        robustness: 'SW_SECURE_CRYPTO',
      },
    },
  });

  // Bridge TTML tracks into videojs and sync menu toggle back to dash.js
  syncVideojsTrackChangesToDash(player);

  // Bridge tracks once metadata is loaded (tracks are available at that point)
  player.on('loadedmetadata', () => {
    setTimeout(() => bridgeDashTextTracks(player), 500);
  });

  // Disable dash.js text rendering by default — let the user opt in via the menu
  player.dash.mediaPlayer.enableText(false);

  player.dash.mediaPlayer.on('periodSwitchCompleted', () => {
    // Re-bridge tracks in case new period has different text tracks
    bridgeDashTextTracks(player);
    // Respect the user's saved captions preference after period switch
    syncDashTextWithSavedPreference(player);
    // Seek to the live edge so the viewer isn't behind after the ad
    if (player.liveTracker) {
      player.liveTracker.seekToLiveEdge();
    }
    // Resume playback if the period transition paused the player
    if (player.paused()) {
      safePlay(player);
    }
  });
}
