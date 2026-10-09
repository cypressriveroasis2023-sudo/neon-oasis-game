/** Independently reviewed exact saved tracker / bridge / provider-area assignments.
 * Commitments only. Provider areas describe reported resource groups, not radio pairings. */
export type ReconReview={trackerProof:string;bridgeKey:string;areaKey:string;providerProof:string;physicalProof:string;resourceIds:string[];sourceKeys:string[];detectorCount:number};
export const REVIEWED_RECON_PROVIDER_GROUPS:Readonly<Record<string,ReconReview>>=Object.freeze({
  "3ffa6bebc98ce6a18fcd19d6864cd427f436814325a402790549612ce3ed816b": {
    "trackerProof": "bd73a29c42c57f60632d424eae04c2117807786b28658c3ed989ffda45e47fc6",
    "bridgeKey": "796b80a6977dc58ab4b786250b8f61e2eb302881181e7c8de177ab5464610dc0",
    "areaKey": "c9f7590b4cca5f5f6988d722608885e877ce4013b7c938fe8615dc33cc83c8d5",
    "providerProof": "615975d6b6774fe7a3b517845fa65be415dd452c6327f28b5429e663c5558d7f",
    "physicalProof": "2003743817699f54ada3b01f724bbad00e95ffe88acd98a1c54eb068d4c73c7b",
    "resourceIds": [
      "9f42396d7b99b6aa9d060852632861a35437610e85858cbceeaebbb6db5e9627",
      "913385cec831e6cf511f6545923755727641a29e0d439f29bd3b0302ac95a5a7"
    ],
    "sourceKeys": [
      "46fa3adf60c53556808de87ae9d1bb44afd0b40fbdc6780c3a2f79f8395f9754"
    ],
    "detectorCount": 2
  },
  "666b98c5d6c3dbaa8f6aef8e5ef4966ce82fc21656f1792ef916e72d22367b36": {
    "trackerProof": "80fa7e7150f33d3d01e04a3c9ab698ffc56b6c1a12d9278b9157c151f4622310",
    "bridgeKey": "1b0dee02fbebfa0753ec4ae2f2cc62bd03f5eda8a613cd315fa51263b776dd65",
    "areaKey": "f71fba6e25c1ec21fc32c6f336d824708cd1ba61c326c77cb14124818f93890c",
    "providerProof": "f7470422ab407fe518a2bc284726ac9e751c2c22a9d0d99f1f6108dccdfad917",
    "physicalProof": "f37c6025a3aed49669d6f7b1d11f99416d49ca84b2922735e84c75fd3f323252",
    "resourceIds": [
      "34dd1ca5c07c3493dcd505dc0fa2bcbfa04838fea4a1f6435868ae4b0d03c070"
    ],
    "sourceKeys": [
      "f48d4e7432d7712aebf9c36911e1c3fdd23d6ee2b48a42087594082300b3e0e0"
    ],
    "detectorCount": 1
  },
  "a3d5e5808743bdf66ae1c5f409f1079134a2b25d704e326468b82cda7e8e478b": {
    "trackerProof": "55b453fa4c1e46103084f7d399feed6d4a973c0758cf2c7a827a85b6f9990491",
    "bridgeKey": "fcc6759136552cc9fea38380c3c6d5155a4971f583dee0224b47a9415d67d3a0",
    "areaKey": "dbbb008cf4f40c5ab04683efcbee61885593812de3ee4a06db1fbd9b0d15e614",
    "providerProof": "a6ec617912b54caa5f6758bc3ecfe3068aab2949e7052c5d6d51f39f29f25305",
    "physicalProof": "c88e733888e276a25c2a5f5fc9dd38e7751945a1a276b9abcec4aa8cde944efe",
    "resourceIds": [
      "d8732d3b3b11d85520784968ca241bc403771157ff2a6cc4aad0dbc54889a1d0",
      "cf0398adf892a53548ff2d4484335bb8a5532eef20ed81955fcbfa5fbecef817",
      "f1140778cd48ebee9585c0c888057e13b26852363441f497c9ca6b3ff427a49d"
    ],
    "sourceKeys": [
      "587a8c64416e8b0d87535f2e5733e3ee9dfd6fb3c6502ac22f2946d47a9df60c"
    ],
    "detectorCount": 3
  },
  "c80fe3061216318990677c6b3ff2ac8b5b7f0dfee527ce05a134375542279bc6": {
    "trackerProof": "da1cf7bca67db7a3b2e867408996649ba0391102845e509bc6e679f21dfeb4e6",
    "bridgeKey": "21484c99e784ecfb90282bd2360b5dfb2ab3d72a9d970f8ea254e39c57d9ba81",
    "areaKey": "ce480f1859d42cd9313e6b4a9dd0cf804b4d8e183ee1a414a38547681053727a",
    "providerProof": "a2df905aec6b7bcbc230dc222303468afc32052ea93659038cd455c3048ecae6",
    "physicalProof": "3d1f821074dc899807d9620ea74c2ad2c29333c5748b5a46cc0af34927b213ac",
    "resourceIds": [
      "9d853a1a9b74c62b4b6565548b92a7bc826005f23251d10b8a045d80e81f7190",
      "b0058f8c81f726c567896f2cf2676102dc6e2e63f8f3a8902636947f33a6a151"
    ],
    "sourceKeys": [
      "392866a4e5f84691d9a60f8c232e5371347f3837f2927bdec45c687e21b15807"
    ],
    "detectorCount": 2
  },
  "d66d9f5d658fbf61dc5bf499a5ef4c9fe0a5c2d7334640a96caa0fe0addb3a25": {
    "trackerProof": "51a1cc815678cfe564aa5ec15ea09014299053e3a157d808c38f0979504b4c65",
    "bridgeKey": "ba29fd8ac5b3448cab8b42a89253cf20a63652893c499873d3d8512ff8e1f892",
    "areaKey": "b669e0064ba7cc84a266b2a375f59d9c335f1766bb4d151618663e6dcfd63c12",
    "providerProof": "56a6e36bb539a11f8550249add7181ef68c2e452216dd9e9c741a09d55245428",
    "physicalProof": "6c8f32714fdda81e02d96784bdd2750585ac108ef5da85dcaed40c25d97dafa8",
    "resourceIds": [
      "956006c85c17539488b1f4a5a15164bcbd5dfe7f0cba61f8f27d26bd1f380e15",
      "c003b482adcd7a9dcf2f91ca6d58147e730e5433b38189613fda75020aa94b77",
      "c157e41eb11a5fecd7f2c208e0e9d17f2dec44e5289c726a1fcbd92be76c4993"
    ],
    "sourceKeys": [
      "d39a821e26efa4123866c0e5ce1a87816808412b9406cad3c4b0fc1175d1602b"
    ],
    "detectorCount": 3
  },
  "e581a6ec4853592798a8c7baa282351f5a11ccc44e2b406b42f58f09ce30215b": {
    "trackerProof": "d7dc1c89173f314789c475c528c0933e4f44839ba4ee8f6473bac374b1d49a31",
    "bridgeKey": "041fb3b42af8cce28522d2697896f75c285c70f1024e2619caaba807d8ac2a34",
    "areaKey": "84648bf77345ef400f66201f8be88c4817e7bdf0e3be33b6c19bc5e425ec56ab",
    "providerProof": "0ad2e04c51b1a1573ad61d09bbf377d2c88da637cf2808c758d5708512c99c94",
    "physicalProof": "e35b3fda65c5007e71022367a1186cd9bb16606f9fe2abc9e2161407ad7895ee",
    "resourceIds": [
      "afc64d1580581a327d2f3999dce7f73f6e4ffc4673962aea663dcf3bc662eb85",
      "d9f30f4f9117d9bb29379b0a183cb87558cf9796e76f260702ee13e26b7cd870",
      "dfcead410e3b8fe1a47cfa65d63d07137dbf2c5f3d7bbcd06dd435808d7d6037",
      "aa02f201bfe30351242c96840743d177477a06acd95af215d924e020806850fd"
    ],
    "sourceKeys": [
      "84bab840b4b20d74cdae6060433c0a4371d3f713138197bb8c68972f7a4e684e"
    ],
    "detectorCount": 4
  },
  "f3f45a899dceff116bf50a367364fa4575f6af5758075faf7485c6b4633795ff": {
    "trackerProof": "556b418e921f7b3aaa38937672a56d8d4f59e8c416328cfe6afca27f162302e8",
    "bridgeKey": "97a0e458ec54d6eaa69ded98e65d6f0d3ce4b417fca451d6565130e25c1693ef",
    "areaKey": "ea5ec2aebcc98515e42a6b5d95deb5a82301c7aae1908b16189340e084d0bbc3",
    "providerProof": "ed139a4468ec49d3bb687262b251ed91005c78eca169622afc9e1dc631261c38",
    "physicalProof": "d1fbb445ba6f957e1aa7e9645040e9d90428eaee14a034d9a63d389ac277a7b7",
    "resourceIds": [
      "3137c96a51c662d44e2f268cd9556dbd5672c05ea0919fcbb28e326f0f100f0a",
      "91fd78be7bbdacd7ee372e2c802859f4d224d120a8d14ddc98a3b849dbd5ade0",
      "3ac2e497ee8cddd52b9951f167170536b2aebfabde75d63c74107f38bdd8c480",
      "0f76483990b6be6d94cf62ccd1f93285f4db91109edd40c0f0298bbd3cfc21e7",
      "c8b37ed30a6efac5003815b91f56cee4864ff142628dab536fd450f0c368a297",
      "015bf3acb2bcc61b4f43673ca8cfbd064816a9b9ea7f33c17100c3a57c75afc1"
    ],
    "sourceKeys": [
      "ddd0c3168cbaa48b5a298ef461a343f3d19167d64e99e7878d247b2042ddd626"
    ],
    "detectorCount": 6
  }
});
