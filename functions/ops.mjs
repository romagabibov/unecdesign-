import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";

const [command, projectId, email, role]=process.argv.slice(2);
if (!projectId || !/^[a-z0-9-]+$/.test(projectId) || !["seed-taxonomy","role"].includes(command)) {
  console.error("Usage: node functions/ops.mjs seed-taxonomy PROJECT_ID | role PROJECT_ID EMAIL admin|student|buyer");
  process.exit(1);
}
initializeApp({projectId});

if (command==="role") {
  if (!email || !["admin","student","buyer"].includes(role)) {
    console.error("Provide an existing Firebase Auth user email and a supported role.");
    process.exit(1);
  }
  const auth=getAuth(), user=await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid,{...user.customClaims,role});
  console.log("Role saved. Sign out and sign in again to refresh access.");
} else {
  const db=getFirestore();
  const entries=[
    ["abstract","Abstraksiya"],["fashion","Geyim"],["sculpture","Heykəltəraşlıq"],
    ["ceramics","Keramika"],["graphics","Qrafika"],["accessories","Aksesuarlar"],
  ].map(([id,name],position)=>({id,name,position,kind:"category",image:"./assets/work-"+position+".webp"}));
  entries.push({id:"studio",name:"Emalatxana seçimi",kind:"section",position:0},{id:"edition",name:"Məhdud tiraj",kind:"section",position:1});
  await db.runTransaction(async tx=>{
    const refs=entries.map(entry=>db.collection("taxonomy").doc(entry.id));
    const snapshots=await tx.getAll(...refs);
    for (const [index,snap] of snapshots.entries()) {
      if (!snap.exists) {
        const {id,...fields}=entries[index];
        tx.create(snap.ref,fields);
      }
    }
  });
  console.log("Initial categories and sections are ready.");
}
