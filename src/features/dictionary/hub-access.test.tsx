import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONSENT_VERSION } from "@hub-consent";
import * as api from "@/features/dictionary/api";
import { HubAccess } from "./hub-access";

vi.mock("@/features/dictionary/api", async () => (await import("@/test/inventory-mock")).dictionaryApiMock());

describe("Request access to the Sophizo Hub", () => {
  it("shows the AI processing consent and sends nothing until it is checked", async () => {
    const user = userEvent.setup();
    render(<HubAccess enrollment={null} onChanged={vi.fn()} />);
    expect(screen.getByText(/processed by third-party AI models/, { selector: "label" })).toBeInTheDocument();
    expect(screen.getByText(/No SLA is defined for this Hub/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Installation name"), "ACME inventory");
    await user.type(screen.getByLabelText("Contact email"), "it@acme.example");
    const send = screen.getByRole("button", { name: "Request access" });
    expect(send).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(send).toBeEnabled();
    await user.click(send);
    expect(api.requestHubAccess).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ACME inventory", contact_email: "it@acme.example", consent: true, consent_version: CONSENT_VERSION }),
    );
  });

  it("an open request shows its state with Check now and Cancel, and no form", async () => {
    render(
      <HubAccess
        enrollment={{ status: "pending", hub_url: "https://mcs.sophizo.com.br", name: "ACME inventory", contact_email: "it@acme.example" } as api.HubEnrollment}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/Waiting for a Hub admin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check now/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel request/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
  });

  it("a rejection shows the admin's note", () => {
    render(<HubAccess enrollment={{ status: "rejected", note: "Unknown organization" } as api.HubEnrollment} onChanged={vi.fn()} />);
    expect(screen.getByText("Note from the Hub admin: Unknown organization")).toBeInTheDocument();
  });
});
