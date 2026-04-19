import { z } from "zod";

const ClientSchema = z.object({
  passport:        z.string(),
  fullName:        z.string(),
  dateOfBirth:     z.string(),
  nationality:     z.string(),
  email:           z.string(),
  phone:           z.string(),
  appointmentType: z.string(),
});

export type ClientData = z.infer<typeof ClientSchema>;
