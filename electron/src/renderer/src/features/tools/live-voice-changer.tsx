import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeadphonesIcon, MicIcon, SquareIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PipelineFailure } from '@/components/pipeline-failure';
import {
  PRESETS,
  applyPreset,
  dismissVoiceChangerError,
  setVoiceDevice,
  startVoiceChanger,
  stopVoiceChanger,
  supportsOutputSelection,
  updateVoiceSettings,
  useVoiceChanger,
  type PresetId,
  type VoiceSettings,
} from './voice-changer-engine';

const DEFAULT_DEVICE = '__default__';

function useAudioDevices(refreshKey: string) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!media || typeof media.enumerateDevices !== 'function') return;
    let alive = true;
    const refresh = () =>
      void media
        .enumerateDevices()
        .then((list) => alive && setDevices(list))
        .catch(() => undefined);
    refresh();
    media.addEventListener?.('devicechange', refresh);
    return () => {
      alive = false;
      media.removeEventListener?.('devicechange', refresh);
    };
  }, [refreshKey]);
  return devices;
}

function DevicePicker({
  label,
  kind,
  devices,
  value,
  fallback,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string;
  fallback: (index: number) => string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const items = [
    { value: DEFAULT_DEVICE, label: t('recording.default_input') },
    ...devices
      // Chromium also lists the OS default as "default"; the first item covers it.
      .filter((device) => device.kind === kind && device.deviceId && device.deviceId !== 'default')
      .map((device, index) => ({ value: device.deviceId, label: device.label || fallback(index) })),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-[length:var(--text-label)] text-muted-foreground">
        {label}
      </Label>
      <Select
        items={items}
        value={items.some((item) => item.value === value) ? value : DEFAULT_DEVICE}
        onValueChange={(next) => {
          if (typeof next === 'string') onChange(next === DEFAULT_DEVICE ? '' : next);
        }}
      >
        <SelectTrigger id={id} className="w-full" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SettingSlider({
  name,
  value,
  min,
  max,
  step,
  display,
}: {
  name: keyof Omit<VoiceSettings, 'radio'>;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
}) {
  const { t } = useTranslation();
  const label = t('voice_changer.' + name);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{display}</span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        thumbProps={{ 'aria-label': label }}
        onValueChange={(next) => {
          const number = Array.isArray(next) ? next[0] : next;
          if (typeof number === 'number') updateVoiceSettings({ [name]: number });
        }}
      />
    </div>
  );
}

const isPreset = (settings: VoiceSettings, id: PresetId) =>
  Object.entries(PRESETS[id]).every(
    ([key, value]) => settings[key as keyof VoiceSettings] === value,
  );

export function LiveVoiceChanger() {
  const { t } = useTranslation();
  const { status, error, settings, inputId, outputId } = useVoiceChanger();
  const running = status === 'running';
  const devices = useAudioDevices(status);
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('voice_changer.title')}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('voice_changer.description')}
        </p>
      </div>
      <p className="flex items-start gap-2 rounded-lg border border-border/50 p-3 text-sm text-muted-foreground">
        <HeadphonesIcon className="mt-0.5 size-4 shrink-0" />
        {t('voice_changer.headphones_hint')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={running ? 'secondary' : 'default'}
          disabled={status === 'starting'}
          onClick={() => void (running ? stopVoiceChanger() : startVoiceChanger())}
        >
          {running ? <SquareIcon /> : <MicIcon />}
          {t(
            status === 'starting'
              ? 'voice_changer.starting'
              : running
                ? 'voice_changer.stop'
                : 'voice_changer.start',
          )}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {running ? t('voice_changer.live') : null}
        </span>
      </div>
      {error && (
        <PipelineFailure
          fallback={t(error.key, error.params)}
          onDismiss={dismissVoiceChangerError}
        />
      )}
      <div className="space-y-2">
        <p className="text-sm">{t('voice_changer.presets')}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('voice_changer.presets')}>
          {(Object.keys(PRESETS) as PresetId[]).map((id) => {
            const active = isPreset(settings, id);
            return (
              <Button
                key={id}
                size="sm"
                variant={active ? 'secondary' : 'outline'}
                aria-pressed={active}
                onClick={() => applyPreset(id)}
              >
                {t('voice_changer.preset_' + id)}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <SettingSlider
          name="pitch"
          value={settings.pitch}
          min={-12}
          max={12}
          step={1}
          display={t('voice_changer.semitones', {
            value: settings.pitch > 0 ? `+${settings.pitch}` : String(settings.pitch),
          })}
        />
        <SettingSlider
          name="tone"
          value={settings.tone}
          min={-1}
          max={1}
          step={0.1}
          display={settings.tone.toFixed(1)}
        />
        <SettingSlider
          name="robot"
          value={settings.robot}
          min={0}
          max={1}
          step={0.05}
          display={percent(settings.robot)}
        />
        <SettingSlider
          name="echo"
          value={settings.echo}
          min={0}
          max={1}
          step={0.05}
          display={percent(settings.echo)}
        />
        <SettingSlider
          name="volume"
          value={settings.volume}
          min={0}
          max={1.5}
          step={0.05}
          display={percent(settings.volume)}
        />
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('voice_changer.radio')}
          <Switch
            checked={settings.radio}
            onCheckedChange={(radio) => updateVoiceSettings({ radio })}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DevicePicker
          label={t('recording.input_device')}
          kind="audioinput"
          devices={devices}
          value={inputId || DEFAULT_DEVICE}
          fallback={(index) => t('recording.microphone_number', { number: index + 1 })}
          onChange={(id) => void setVoiceDevice('inputId', id)}
        />
        {supportsOutputSelection() && (
          <DevicePicker
            label={t('voice_changer.output_device')}
            kind="audiooutput"
            devices={devices}
            value={outputId || DEFAULT_DEVICE}
            fallback={(index) => t('voice_changer.output_number', { number: index + 1 })}
            onChange={(id) => void setVoiceDevice('outputId', id)}
          />
        )}
      </div>
      <div className="space-y-1.5 rounded-xl border border-border/50 p-4 text-sm">
        <p className="font-medium">{t('voice_changer.calls_title')}</p>
        <p className="leading-6 text-muted-foreground">{t('voice_changer.calls_hint')}</p>
      </div>
    </div>
  );
}
