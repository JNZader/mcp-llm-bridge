import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Login } from "../Login.tsx";
import { AuthProvider } from "../../context/AuthContext.tsx";

function mockAuthConfig(githubOauth: boolean) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ githubOauth }),
  });
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Login", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("when GitHub OAuth is not configured", () => {
    beforeEach(() => {
      globalThis.fetch = mockAuthConfig(false);
    });

    it("renders the admin token input directly", async () => {
      renderLogin();
      await waitFor(() => {
        expect(screen.getByLabelText("Admin Token")).toBeInTheDocument();
      });
    });

    it("renders a connect button", async () => {
      renderLogin();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
      });
    });

    it("renders the app title", async () => {
      renderLogin();
      await waitFor(() => {
        expect(screen.getByText("MCP LLM Bridge")).toBeInTheDocument();
      });
    });

    it("shows error on failed connection (network error)", async () => {
      const authConfigFetch = mockAuthConfig(false);
      globalThis.fetch = vi
        .fn()
        .mockImplementationOnce(authConfigFetch)
        .mockRejectedValue(new TypeError("fetch failed"));

      const user = userEvent.setup();
      renderLogin();

      const tokenInput = await screen.findByLabelText("Admin Token");
      const button = screen.getByRole("button", { name: "Connect" });

      await user.type(tokenInput, "bad-token");
      await user.click(button);

      await waitFor(() => {
        expect(
          screen.getByText(/could not connect to the gateway/i),
        ).toBeInTheDocument();
      });
    });

    it("shows error on 401 response (invalid token)", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ githubOauth: false }) })
        .mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

      const user = userEvent.setup();
      renderLogin();

      const tokenInput = await screen.findByLabelText("Admin Token");
      const button = screen.getByRole("button", { name: "Connect" });

      await user.type(tokenInput, "wrong-token");
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText(/invalid admin token/i)).toBeInTheDocument();
      });
    });

    it("shows error on non-401 server error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ githubOauth: false }) })
        .mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });

      const user = userEvent.setup();
      renderLogin();

      const tokenInput = await screen.findByLabelText("Admin Token");
      const button = screen.getByRole("button", { name: "Connect" });

      await user.type(tokenInput, "some-token");
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText(/server returned 500/i)).toBeInTheDocument();
      });
    });

    it("token input is required", async () => {
      renderLogin();
      const tokenInput = await screen.findByLabelText("Admin Token");
      expect(tokenInput).toBeRequired();
    });
  });

  describe("when GitHub OAuth is configured", () => {
    beforeEach(() => {
      globalThis.fetch = mockAuthConfig(true);
    });

    it("renders the GitHub login button", async () => {
      renderLogin();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /continue with github/i }),
        ).toBeInTheDocument();
      });
    });

    it("does not show admin token input by default", async () => {
      renderLogin();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /continue with github/i }),
        ).toBeInTheDocument();
      });
      expect(screen.queryByLabelText("Admin Token")).not.toBeInTheDocument();
    });

    it("shows admin token form when 'Use admin token' is clicked", async () => {
      renderLogin();
      const user = userEvent.setup();

      const toggle = await screen.findByRole("button", { name: /use admin token/i });
      await user.click(toggle);

      expect(screen.getByPlaceholderText("Enter your ADMIN_TOKEN")).toBeInTheDocument();
    });
  });
});
