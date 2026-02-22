const LINEAR_API = "https://api.linear.app/graphql";
const JOSHUA_ID = "9f0978e8-76bb-41de-b83d-6773d7c87fd9";

function getToken(): string {
  const t = process.env.LINEAR_API_KEY;
  if (!t) throw new Error("LINEAR_API_KEY environment variable not set");
  return t;
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const resp = await fetch(LINEAR_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: getToken() },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  state: { name: string; type: string };
  priority: number;
  url: string;
}

export async function getBacklogTickets(): Promise<LinearTicket[]> {
  const data = await gql(`
    query {
      issues(
        filter: {
          assignee: { id: { eq: "${JOSHUA_ID}" } }
          state: { type: { in: ["unstarted", "backlog"] } }
        }
        orderBy: priority
        first: 20
      ) {
        nodes { id identifier title url priority state { name type } }
      }
    }
  `) as { issues: { nodes: LinearTicket[] } };
  return data.issues.nodes;
}

export async function getTicket(identifier: string): Promise<LinearTicket | null> {
  const data = await gql(`
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 1) {
        nodes { id identifier title url priority state { name type } }
      }
    }
  `, { filter: { identifier: { eq: identifier } } }) as { issues: { nodes: LinearTicket[] } };
  return data.issues.nodes[0] ?? null;
}

export async function getStates(): Promise<Array<{ id: string; name: string; type: string }>> {
  const data = await gql(`
    query {
      workflowStates(filter: { team: { key: { eq: "AMA" } } }) {
        nodes { id name type }
      }
    }
  `) as { workflowStates: { nodes: Array<{ id: string; name: string; type: string }> } };
  return data.workflowStates.nodes;
}

export async function updateTicketState(identifier: string, stateName: string): Promise<string> {
  const ticket = await getTicket(identifier);
  if (!ticket) throw new Error(`Ticket ${identifier} not found`);
  const states = await getStates();
  const state = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
  if (!state) throw new Error(`State "${stateName}" not found. Available: ${states.map((s) => s.name).join(", ")}`);
  await gql(`
    mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }
  `, { id: ticket.id, stateId: state.id });
  return `${identifier} moved to "${state.name}"`;
}

export async function assignTicket(identifier: string, assigneeName: string): Promise<string> {
  const ticket = await getTicket(identifier);
  if (!ticket) throw new Error(`Ticket ${identifier} not found`);
  if (!assigneeName.toLowerCase().includes("joshua")) {
    throw new Error(`Only "Joshua" is supported as assignee right now`);
  }
  await gql(`
    mutation($id: String!, $assigneeId: String!) {
      issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success }
    }
  `, { id: ticket.id, assigneeId: JOSHUA_ID });
  return `${identifier} assigned to Joshua`;
}
