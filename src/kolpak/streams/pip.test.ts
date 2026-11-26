import { describe, expect, it } from 'vitest';
import { borrowPlayer } from './sharedPlayer';

describe('borrowPlayer', () => {
  it('moves the shared video into the stage and back to where it was', () => {
    const home = document.createElement('div');
    const stage = document.createElement('div');
    document.body.append(home, stage);
    // The first borrow creates the shared video; put it in its home first.
    const giveBackFirst = borrowPlayer(home);
    const video = home.querySelector('video');
    expect(video).not.toBeNull();
    giveBackFirst();

    home.appendChild(video!);
    const giveBack = borrowPlayer(stage);
    expect(stage.contains(video)).toBe(true);
    giveBack();
    expect(home.contains(video)).toBe(true);
    home.remove();
    stage.remove();
  });
});
