// Explicit synthetic activation for legacy integration fixtures. Runtime signup
// does not activate ordinary members; tests of that flow must not use this helper.
export function seedActiveAccounts(sql,env){
 for(const {email,role} of JSON.parse(env.AUTHORIZED_ACCOUNTS||'[]')){
  sql.prepare("INSERT INTO accounts(email,role,enabled,status) VALUES (?,?,1,'active') ON CONFLICT(email) DO NOTHING").run(email,role);
 }
}
