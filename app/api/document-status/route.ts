import {withDocumentUser} from "@/lib/documents/http";
import {documentsEnabled} from "@/lib/documents/lifecycle";
export async function GET(request:Request){return withDocumentUser(request,async()=>({enabled:await documentsEnabled()}));}
