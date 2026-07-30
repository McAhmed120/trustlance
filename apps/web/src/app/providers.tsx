'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { ApiClientError } from '@/lib/api';
import { ThemeProvider } from '@/components/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry(failureCount, error) {
              // Retrying a 4xx just repeats a request the server already
              // rejected on its merits. Only retry transient failures.
              if (error instanceof ApiClientError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  const bootstrap = useAuthStore((s) => s.bootstrap);

  // Rebuilds the in-memory access token from the httpOnly refresh cookie on
  // first mount, so a reload doesn't look like a logout.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
