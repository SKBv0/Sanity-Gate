export type LoggerFunction = (
  level: string,
  category: string,
  message: string,
  data?: unknown
) => void;

const formatData = (data?: unknown) => {
  if (data === undefined) {
    return '';
  }
  if (typeof data === 'string') {
    return ` | Data: ${data}`;
  }
  try {
    return ` | Data: ${JSON.stringify(data)}`;
  } catch {
    return ' | Data: [unserializable]';
  }
};

export function createServerLogger(category: string): LoggerFunction {
  return (level: string, _category: string, message: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    const logData = formatData(data);
    console.log(`[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}${logData}`);
  };
}

