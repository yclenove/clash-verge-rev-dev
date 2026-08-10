import { useLocalStorage } from 'foxact/use-local-storage'

const defaultClashLog: IClashLog = {
  enable: true,
  streamPaused: false,
  logLevel: 'INFO',
  logFilter: 'all',
  logOrder: 'asc',
}

const deserializeClashLog = (value: string): IClashLog => {
  const parsed = JSON.parse(value) as IClashLog
  if (parsed.streamPaused === undefined) {
    parsed.streamPaused = parsed.enable === false
  }
  return parsed
}

export const useClashLog = () =>
  useLocalStorage<IClashLog>('clash-log', defaultClashLog, {
    serializer: JSON.stringify,
    deserializer: deserializeClashLog,
  })
