import { describe, expect, it } from 'vitest';
import { formatKeyCode, resolveVoiceSettings, sanitizeStoredVoiceSettings } from './voiceSettings';

const defaults = { host: 'mumble.example', port: 64738, username: 'pyro' };

describe('resolveVoiceSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(resolveVoiceSettings({}, defaults)).toEqual({
      host: 'mumble.example',
      port: 64738,
      username: 'pyro',
      autoConnect: false,
      transmitMode: 'vad',
      pttKey: '',
      inputDevice: '',
      vadThreshold: 0.02,
      outputDevice: '',
      outputVolume: 1,
      noiseSuppression: true,
    });
  });

  it('prefers saved values, and treats blank text as not set', () => {
    const resolved = resolveVoiceSettings(
      { host: '  ', username: 'DatPyro', port: 1234, transmitMode: 'ptt', pttKey: 'KeyV' },
      defaults
    );
    expect(resolved.host).toBe('mumble.example');
    expect(resolved.username).toBe('DatPyro');
    expect(resolved.port).toBe(1234);
    expect(resolved.transmitMode).toBe('ptt');
    expect(resolved.pttKey).toBe('KeyV');
  });
});

describe('sanitizeStoredVoiceSettings', () => {
  it('drops malformed fields and keeps good ones', () => {
    expect(
      sanitizeStoredVoiceSettings({
        host: 'h',
        port: 70000,
        username: 5,
        autoConnect: 'yes',
        transmitMode: 'shout',
        pttKey: 'CapsLock',
        inputDevice: 'mic-1',
        vadThreshold: 3,
        outputDevice: 'out-1',
        outputVolume: 9,
      })
    ).toEqual({ host: 'h', pttKey: 'CapsLock', inputDevice: 'mic-1', outputDevice: 'out-1' });
  });

  it('returns nothing for values that are not objects', () => {
    expect(sanitizeStoredVoiceSettings(null)).toEqual({});
    expect(sanitizeStoredVoiceSettings('x')).toEqual({});
    expect(sanitizeStoredVoiceSettings([1])).toEqual({});
  });
});

describe('formatKeyCode', () => {
  it('names keys the way people read them', () => {
    expect(formatKeyCode('KeyV')).toBe('V');
    expect(formatKeyCode('Digit4')).toBe('4');
    expect(formatKeyCode('Backquote')).toBe('`');
    expect(formatKeyCode('CapsLock')).toBe('Caps Lock');
    expect(formatKeyCode('F13')).toBe('F13');
    expect(formatKeyCode('')).toBe('not set');
  });
});
