import {createProtectedNativeIntakeSource} from './index.ts';
Deno.serve(createProtectedNativeIntakeSource({env:name=>Deno.env.get(name),fetch}));
