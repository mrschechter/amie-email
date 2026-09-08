import { GetServerSideProps } from "next";
import qs from "qs";

export const getServerSideProps: GetServerSideProps = async ({ query }) => ({
  redirect: {
    destination: `/analysis/overview?${qs.stringify(query)}`,
    permanent: false,
  },
});
export default function AnalysisIndex() {
  return null;
}
