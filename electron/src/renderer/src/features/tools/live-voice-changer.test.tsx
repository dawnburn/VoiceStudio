import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PRESETS, resetVoiceChangerForTests, voiceChanger } from './voice-changer-engine';

const mock = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./voice-changer-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./voice-changer-engine')>()),
  startVoiceChanger: mock.start,
  stopVoiceChanger: mock.stop,
}));
import { LiveVoiceChanger } from './live-voice-changer';

afterEach(() => {
  cleanup();
  resetVoiceChangerForTests();
  vi.clearAllMocks();
});

it('starts and stops from one button', () => {
  render(<LiveVoiceChanger />);
  fireEvent.click(screen.getByRole('button', { name: 'voice_changer.start' }));
  expect(mock.start).toHaveBeenCalledOnce();
  act(() => voiceChanger.setState((state) => ({ ...state, status: 'running' })));
  fireEvent.click(screen.getByRole('button', { name: 'voice_changer.stop' }));
  expect(mock.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toBe('voice_changer.live');
});

it('marks the active preset and applies a new one', () => {
  render(<LiveVoiceChanger />);
  const natural = screen.getByRole('button', { name: 'voice_changer.preset_natural' });
  expect(natural.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'voice_changer.preset_deep' }));
  expect(voiceChanger.state.settings).toMatchObject(PRESETS.deep);
  expect(
    screen.getByRole('button', { name: 'voice_changer.preset_deep' }).getAttribute('aria-pressed'),
  ).toBe('true');
  expect(natural.getAttribute('aria-pressed')).toBe('false');
});

it('shows a start error', () => {
  voiceChanger.setState((state) => ({ ...state, error: { key: 'recording.mic_denied' } }));
  render(<LiveVoiceChanger />);
  expect(screen.getByText('recording.mic_denied')).toBeTruthy();
});
