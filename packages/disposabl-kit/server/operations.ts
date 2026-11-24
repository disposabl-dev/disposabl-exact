import * as counter from "../../backend/convex/counter";
import { createOperations } from "./functions";

// Add modules here to expose their opted-in functions to REST and MCP.
export const platformOperations = createOperations({ counter });
