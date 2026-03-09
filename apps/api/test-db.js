import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data, error } = await supabase.from('community_classes').select('*').limit(1);
  if (error) {
    if (error.code === '42P01') {
      console.log('TABLE_MISSING');
    } else {
      console.error('ERROR:', error.message);
    }
  } else {
    console.log('TABLE_EXISTS:', data);
  }
}

test();
