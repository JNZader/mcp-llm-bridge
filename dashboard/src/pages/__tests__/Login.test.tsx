import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Login } from "../Login.tsx";
import { AuthProvider } from "../../context/AuthContext.tsx";

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

  it("renders gateway URL and token inputs", () => {
    renderLogin();

    expect(screen.getByLabelText("Gateway URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Admin Token")).toBeInTheDocument();
  });

  it("renders a connect button", () => {
    renderLogin();

    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("renders the app title", () => {
    renderLogin();

    expect(screen.getByText("MCP LLM Bridge")).toBeInTheDocument();
  });

  it("shows error on failed connection (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();

    renderLogin();

    const urlInput = screen.getByLabelText("Gateway URL");
    const tokenInput = screen.getByLabelText("Admin Token");
    const button = screen.getByRole("button", { name: "Connect" });

    await user.clear(urlInput);
    await user.type(urlInput, "http://localhost:9999");
    await user.type(tokenInput, "bad-token");
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByText(/could not connect to the gateway/i),
      ).toBeInTheDocument();
    });
  });

  it("shows error on 401 response (invalid token)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    const user = userEvent.setup();

    renderLogin();

    const urlInput = screen.getByLabelText("Gateway URL");
    const tokenInput = screen.getByLabelText("Admin Token");
    const button = screen.getByRole("button", { name: "Connect" });

    await user.clear(urlInput);
    await user.type(urlInput, "http://localhost:3456");
    await user.type(tokenInput, "wrong-token");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/invalid admin token/i)).toBeInTheDocument();
    });
  });

  it("shows error on non-401 server error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    const user = userEvent.setup();

    renderLogin();

    const urlInput = screen.getByLabelText("Gateway URL");
    const tokenInput = screen.getByLabelText("Admin Token");
    const button = screen.getByRole("button", { name: "Connect" });

    await user.clear(urlInput);
    await user.type(urlInput, "http://localhost:3456");
    await user.type(tokenInput, "some-token");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/server returned 500/i)).toBeInTheDocument();
    });
  });

  it("shows loading state while connecting", async () => {
    // Never resolve the fetch to keep loading state
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();

    renderLogin();

    const urlInput = screen.getByLabelText("Gateway URL");
    const tokenInput = screen.getByLabelText("Admin Token");
    const button = screen.getByRole("button", { name: "Connect" });

    await user.clear(urlInput);
    await user.type(urlInput, "http://localhost:3456");
    await user.type(tokenInput, "some-token");
    await user.click(button);

    expect(screen.getByText("Connecting...")).toBeInTheDocument();
  });

  it("requires both fields (HTML validation)", () => {
    renderLogin();

    const urlInput = screen.getByLabelText("Gateway URL");
    const tokenInput = screen.getByLabelText("Admin Token");

    expect(urlInput).toBeRequired();
    expect(tokenInput).toBeRequired();
  });
});
