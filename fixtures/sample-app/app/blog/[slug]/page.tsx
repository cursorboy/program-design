export default function BlogPostPage({ params }: { params: { slug: string } }) {
  return (
    <main>
      <h1>Blog: {params.slug}</h1>
    </main>
  );
}
