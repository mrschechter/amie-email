import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { AmieComposerConfigResponse } from "isomorphic-lib/src/amieComposer";

import { useAuthHeaders, useBaseApiUrl } from "./authModeProvider";

export function useAmieComposerConfigQuery() {
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();

  return useQuery({
    queryKey: ["amieComposerConfig", baseApiUrl],
    queryFn: async (): Promise<AmieComposerConfigResponse> => {
      const response = await axios.get<AmieComposerConfigResponse>(
        `${baseApiUrl}/content/templates/compose/config`,
        { headers: authHeaders },
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
