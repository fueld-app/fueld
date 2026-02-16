import { createApp } from '../../src/index';

let appPromise: ReturnType<typeof createApp> | null = null;

export async function getE2EApp() {
  if (!appPromise) {
    appPromise = createApp({
      runMigrations: false,
      enableBackgroundJobs: false,
    });
  }
  return appPromise;
}

interface JsonRequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

interface RawRequestOptions {
  method?: string;
  body?: BodyInit;
  token?: string;
  headers?: HeadersInit;
}

export async function requestRaw(path: string, options: RawRequestOptions = {}) {
  const app = await getE2EApp();
  const headers = new Headers(options.headers ?? {});

  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
    }),
  );

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const data = contentType.includes('application/json') && text ? JSON.parse(text) : text;

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

export async function requestJson(path: string, options: JsonRequestOptions = {}) {
  const app = await getE2EApp();
  const headers = new Headers();

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const data = contentType.includes('application/json') && text ? JSON.parse(text) : text;

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

export async function loginE2E(email: string, password: string) {
  const res = await requestJson('/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  return {
    ...res,
    accessToken: res.data?.data?.accessToken as string | undefined,
    refreshToken: res.data?.data?.refreshToken as string | undefined,
  };
}
