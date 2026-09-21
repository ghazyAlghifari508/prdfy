"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { ThemeAttributeSync } from "@/components/ui/theme-sync";

export function Providers({
	children,
	queryClient: externalQueryClient,
}: {
	children: React.ReactNode;
	queryClient?: QueryClient;
}) {
	const [fallbackClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 60 * 1000,
						refetchOnWindowFocus: false,
					},
				},
			}),
	);

	const client = externalQueryClient ?? fallbackClient;

	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			<QueryClientProvider client={client}>
			<ThemeAttributeSync />
			{children}
		</QueryClientProvider>
		</ThemeProvider>
	);
}
