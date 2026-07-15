import { useCallback, useEffect, useRef, useState } from 'react';

export type AiReportingDictationError =
  | 'microphone-permission'
  | 'microphone-unavailable'
  | 'recording-failed'
  | 'no-speech'
  | 'transcription-unavailable'
  | 'transcription-failed';

interface UseAiReportingDictationOptions {
  language: string;
  onError: (error: AiReportingDictationError) => void;
  onTranscript: (transcript: string) => void;
  transcribe: (audio: Blob, language: string) => Promise<string>;
}

interface RecordingSession {
  id: number;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  mimeType: string;
  shouldTranscribe: boolean;
}

const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
];

const getSupportedMimeType = () =>
  RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';

const isRecordingSupported = () =>
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== 'undefined';

const stopTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

const getMicrophoneError = (error: unknown): AiReportingDictationError => {
  const name = error instanceof DOMException ? error.name : (error as { name?: unknown })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'microphone-permission';
  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'NotReadableError' ||
    name === 'TrackStartError'
  ) {
    return 'microphone-unavailable';
  }
  return 'recording-failed';
};

const getTranscriptionError = (error: unknown): AiReportingDictationError => {
  const errorCode = (error as { errorCode?: unknown })?.errorCode;
  if (errorCode === 'dictation_no_speech') return 'no-speech';
  if (errorCode === 'dictation_transcription_unavailable') return 'transcription-unavailable';
  return 'transcription-failed';
};

export const useAiReportingDictation = ({
  language,
  onError,
  onTranscript,
  transcribe,
}: UseAiReportingDictationOptions) => {
  const sessionRef = useRef<RecordingSession | null>(null);
  const operationIdRef = useRef(0);
  const isRequestingMicrophoneRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const isSupported = isRecordingSupported();

  const cancel = useCallback(() => {
    operationIdRef.current += 1;
    isRequestingMicrophoneRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      session.shouldTranscribe = false;
      stopTracks(session.stream);
      if (session.recorder.state !== 'inactive') session.recorder.stop();
    }
    setIsListening(false);
    setIsTranscribing(false);
  }, []);

  const finish = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.recorder.state === 'inactive') return;
    session.shouldTranscribe = true;
    setIsListening(false);
    session.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (
      !isRecordingSupported() ||
      sessionRef.current ||
      isRequestingMicrophoneRef.current ||
      isTranscribing
    ) {
      return;
    }

    const id = operationIdRef.current + 1;
    isRequestingMicrophoneRef.current = true;
    operationIdRef.current = id;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      isRequestingMicrophoneRef.current = false;
    } catch (error) {
      isRequestingMicrophoneRef.current = false;
      if (operationIdRef.current === id) onError(getMicrophoneError(error));
      return;
    }

    if (operationIdRef.current !== id) {
      stopTracks(stream);
      return;
    }

    try {
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const session: RecordingSession = {
        id,
        recorder,
        stream,
        chunks: [],
        mimeType: mimeType || recorder.mimeType || 'audio/webm',
        shouldTranscribe: false,
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) session.chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        operationIdRef.current += 1;
        stopTracks(stream);
        setIsListening(false);
        onError('recording-failed');
      };
      recorder.onstop = async () => {
        stopTracks(stream);
        if (sessionRef.current !== session || !session.shouldTranscribe) return;
        sessionRef.current = null;

        const audio = new Blob(session.chunks, { type: session.mimeType });
        if (audio.size === 0) {
          onError('no-speech');
          return;
        }

        setIsTranscribing(true);
        try {
          const transcript = await transcribe(audio, language);
          if (operationIdRef.current === session.id && transcript.trim()) {
            onTranscript(transcript.trim());
          }
        } catch (error) {
          if (operationIdRef.current === session.id) onError(getTranscriptionError(error));
        } finally {
          if (operationIdRef.current === session.id) setIsTranscribing(false);
        }
      };

      sessionRef.current = session;
      recorder.start();
      setIsListening(true);
    } catch (error) {
      sessionRef.current = null;
      stopTracks(stream);
      if (operationIdRef.current === id) onError(getMicrophoneError(error));
    }
  }, [isTranscribing, language, onError, onTranscript, transcribe]);

  const toggle = useCallback(() => {
    if (isListening) {
      finish();
    } else {
      void start();
    }
  }, [finish, isListening, start]);

  useEffect(() => cancel, [cancel]);

  return { isListening, isSupported, isTranscribing, stop: cancel, toggle };
};
